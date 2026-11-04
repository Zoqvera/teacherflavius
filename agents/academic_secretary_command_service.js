(function (browser) {
  "use strict";

  const commandsModule = typeof module !== "undefined" && module.exports
    ? require("./academic_secretary_commands")
    : browser && browser.TeacherAcademicCommands;
  if (!commandsModule) throw new Error("Interpretador da Secretaria Acadêmica indisponível.");

  const MAX_CANDIDATES = 10;
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  function readResponse(response, context) {
    if (!response || response.error) throw new Error("Consulta administrativa indisponível: " + context + ".");
    return response.data;
  }

  function validateDependencies(client, readers, academicPlanner) {
    if (!client || typeof client.from !== "function" || typeof client.rpc !== "function" ||
        !readers || typeof readers.isTeacherAuthorized !== "function" ||
        typeof readers.getClassSnapshot !== "function" ||
        !academicPlanner || typeof academicPlanner.plan !== "function") {
      throw new TypeError("Dependências autenticadas do Agente de Secretaria ausentes.");
    }
  }

  function escapedIlikeTerm(name) {
    return String(name).replace(/[\\%_]/g, "\\$&");
  }

  function validateCandidate(candidate) {
    return candidate && typeof candidate.id === "string" && UUID_PATTERN.test(candidate.id) &&
      typeof candidate.name === "string" && candidate.name.trim().length >= 2 &&
      typeof candidate.archived === "boolean";
  }

  function createAcademicCommandService(client, readers, academicPlanner) {
    validateDependencies(client, readers, academicPlanner);

    async function authorize() {
      if (await readers.isTeacherAuthorized() !== true) {
        throw new Error("Acesso administrativo não autorizado.");
      }
    }

    async function findStudentCandidates(name) {
      const data = readResponse(await client.from("profiles")
        .select("id,name,archived")
        .ilike("name", "%" + escapedIlikeTerm(name) + "%")
        .order("name", { ascending: true })
        .limit(MAX_CANDIDATES + 1), "identificação do aluno");
      if (!Array.isArray(data) || data.some(item => !validateCandidate(item))) {
        throw new Error("Identificação dos alunos indisponível ou inconsistente.");
      }
      return data;
    }

    async function availableClasses() {
      const data = readResponse(await client.rpc("get_public_class_seat_availability"),
        "vagas por turma");
      if (!Array.isArray(data)) throw new Error("Lista de vagas inconsistente.");
      const seen = new Set();
      const available = [];
      for (const entry of data) {
        if (!entry || !Number.isSafeInteger(entry.class_number) || entry.class_number < 1 ||
            !Number.isSafeInteger(entry.available_spots) || entry.available_spots < 0 ||
            typeof entry.sold_out !== "boolean" ||
            entry.sold_out !== (entry.available_spots === 0) ||
            seen.has(entry.class_number)) {
          throw new Error("Lista de vagas inconsistente.");
        }
        seen.add(entry.class_number);
        if (entry.available_spots > 0) {
          available.push({ number: entry.class_number, availableSeats: entry.available_spots });
        }
      }
      return Object.freeze(available.sort((a, b) => a.number - b.number)
        .map(entry => Object.freeze(entry)));
    }

    async function process(text, selectedStudentId) {
      const parsed = commandsModule.parseAcademicCommand(text);
      if (parsed.status !== "recognized") return parsed;
      await authorize();

      if (parsed.action === commandsModule.ACTIONS.INSPECT_CLASS) {
        const classroom = await readers.getClassSnapshot(parsed.classNumber);
        return Object.freeze({ status: "class_read", action: parsed.action, classNumber: classroom.number,
          availableSeats: classroom.availableSeats });
      }
      if (parsed.action === commandsModule.ACTIONS.AVAILABLE_CLASSES) {
        return Object.freeze({ status: "classes_read", action: parsed.action,
          classes: await availableClasses() });
      }

      const matches = await findStudentCandidates(parsed.studentName);
      if (matches.length === 0) {
        return Object.freeze({ status: "not_found", studentName: parsed.studentName });
      }
      if (matches.length > MAX_CANDIDATES) {
        return Object.freeze({ status: "too_many", studentName: parsed.studentName });
      }
      if (selectedStudentId != null && !matches.some(candidate => candidate.id === selectedStudentId)) {
        throw new Error("A identidade selecionada não corresponde à busca atual.");
      }
      if (matches.length > 1 && !selectedStudentId) {
        return Object.freeze({ status: "ambiguous", studentName: parsed.studentName,
          candidates: Object.freeze(matches.map(person => Object.freeze({
            id: person.id, name: person.name, archived: person.archived
          }))) });
      }
      const student = matches.find(person => person.id === selectedStudentId) || matches[0];
      const request = { action: parsed.action, studentId: student.id };
      if (parsed.classNumber) request.classNumber = parsed.classNumber;
      if (parsed.fromClassNumber) request.fromClassNumber = parsed.fromClassNumber;
      if (parsed.source) request.source = parsed.source;
      if (parsed.firstLessonDate) request.firstLessonDate = parsed.firstLessonDate;

      let plan = await academicPlanner.plan(request);
      // The previous class is inferred only for one unambiguous existing link.
      if (parsed.action === commandsModule.ACTIONS.TRANSFER && !request.fromClassNumber &&
          plan.snapshot && Array.isArray(plan.snapshot.classNumbers) &&
          plan.snapshot.classNumbers.length === 1 &&
          plan.snapshot.classNumbers[0] !== request.classNumber) {
        request.fromClassNumber = plan.snapshot.classNumbers[0];
        plan = await academicPlanner.plan(request);
      }
      return Object.freeze({ status: "plan", student: Object.freeze({ id: student.id, name: student.name }),
        request: Object.freeze(request), plan });
    }

    return Object.freeze({ process });
  }

  const api = Object.freeze({ createAcademicCommandService });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (browser) browser.TeacherAcademicCommandService = api;
})(typeof window !== "undefined" ? window : null);
