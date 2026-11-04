(function (browser) {
  "use strict";

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function assertClient(client, readers) {
    if (!client || typeof client.rpc !== "function" || typeof client.from !== "function" ||
        !readers || typeof readers.isTeacherAuthorized !== "function" ||
        typeof readers.getStudentSnapshot !== "function") {
      throw new TypeError("Dependências acadêmicas autenticadas indisponíveis.");
    }
  }

  function validateRequest(request) {
    if (!request || request.action !== "archive" || request.confirmed !== true ||
        typeof request.studentId !== "string" || !UUID_PATTERN.test(request.studentId)) {
      throw new Error("Arquivamento não confirmado ou identificador inválido.");
    }
    const numbers = request.expectedClassNumbers;
    if (!Array.isArray(numbers) || numbers.length > 2 ||
        numbers.some(number => !Number.isInteger(number) || number <= 0) ||
        new Set(numbers).size !== numbers.length) {
      throw new Error("A prévia dos vínculos não é válida.");
    }
    return numbers.slice().sort((a, b) => a - b);
  }

  function assertSameMemberships(actual, expected) {
    if (actual.length !== expected.length ||
        actual.some((number, index) => number !== expected[index])) {
      throw new Error("Os vínculos do aluno mudaram após a prévia. Consulte novamente antes de arquivar.");
    }
  }

  function readResponse(response, label) {
    if (!response || response.error) {
      throw new Error("Falha na verificação de " + label + ". Confirme o estado do aluno antes de tentar novamente.");
    }
    return response.data;
  }

  function createSupervisedArchiveExecutor(client, readers) {
    assertClient(client, readers);

    async function readBillingActive(studentId) {
      const billing = readResponse(await client.from("student_billing_settings")
        .select("student_id,active")
        .eq("student_id", studentId)
        .maybeSingle(), "cobranças");
      if (billing === null) return null;
      if (!billing || billing.student_id !== studentId ||
          typeof billing.active !== "boolean") {
        throw new Error("Dados de cobrança inconsistentes. Operação interrompida.");
      }
      return billing.active;
    }

    async function executeArchive(request) {
      const expected = validateRequest(request);
      if (await readers.isTeacherAuthorized() !== true) {
        throw new Error("Acesso administrativo não autorizado.");
      }

      const before = await readers.getStudentSnapshot(request.studentId);
      if (before.archived !== false) {
        throw new Error("Aluno já arquivado. Atualize a consulta antes de continuar.");
      }
      assertSameMemberships(before.classNumbers, expected);

      // Avoid changing records if billing status cannot be inspected.
      await readBillingActive(request.studentId);

      // Existing RPC and its database trigger run within a PostgreSQL transaction.
      // Never reproduce unlinking or billing changes as separate browser writes.
      const response = await client.rpc("archive_teacher_student", {
        target_user_id: request.studentId
      });
      readResponse(response, "execução do arquivamento");

      const after = await readers.getStudentSnapshot(request.studentId);
      const billingActive = await readBillingActive(request.studentId);
      if (after.archived !== true || after.classNumbers.length !== 0 || billingActive === true) {
        throw new Error("O arquivamento foi solicitado, mas sua integridade não pôde ser confirmada. Verifique o cadastro antes de tentar novamente.");
      }

      return Object.freeze({
        status: "verified",
        studentId: request.studentId,
        archived: true,
        linkedClasses: 0,
        monthlyBillingActive: billingActive
      });
    }

    return Object.freeze({ executeArchive });
  }

  const api = Object.freeze({ createSupervisedArchiveExecutor });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (browser) browser.TeacherAcademicArchiveExecutor = api;
})(typeof window !== "undefined" ? window : null);
