(function (browser) {
  "use strict";

  const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const SOURCE_TYPES = new Set([
    "instagram", "facebook", "google", "chatgpt", "referral", "getninjas", "other", "unknown"
  ]);

  function assertClassNumbers(numbers) {
    if (!Array.isArray(numbers) || numbers.length > 2 ||
        numbers.some(value => !Number.isSafeInteger(value) || value < 1) ||
        new Set(numbers).size !== numbers.length) {
      throw new Error("Prévia de vínculos inconsistente.");
    }
    return Object.freeze([...numbers].sort((a, b) => a - b));
  }

  function assertReadyPlan(plan, request) {
    if (!plan || !request || plan.status !== "ready_for_review" ||
        plan.readOnly !== true || plan.requiresAtomicExecution !== true ||
        plan.action !== request.action || plan.studentId !== request.studentId ||
        !ID_PATTERN.test(request.studentId) ||
        !["new_link", "transfer"].includes(request.action) ||
        !Number.isSafeInteger(request.classNumber) || request.classNumber < 1 ||
        !plan.snapshot || plan.snapshot.archived !== false ||
        plan.blockers.length !== 0 || plan.missingFields.length !== 0) {
      throw new Error("A operação exige uma prévia válida e sem impedimentos.");
    }
  }

  function buildAcademicChangeTransaction(plan, request) {
    assertReadyPlan(plan, request);
    const previousClasses = assertClassNumbers(plan.snapshot.classNumbers);
    if (previousClasses.includes(request.classNumber)) {
      throw new Error("O aluno já está vinculado à turma de destino.");
    }

    const args = {
      target_action: request.action,
      target_student_id: request.studentId,
      target_class_number: request.classNumber,
      expected_class_numbers: previousClasses,
      target_from_class_number: null,
      target_first_lesson_date: null,
      target_source: null,
      target_source_detail: null
    };

    if (request.action === "new_link") {
      if (previousClasses.length >= 2 || request.fromClassNumber != null ||
          !SOURCE_TYPES.has(plan.canonicalSource) ||
          typeof request.firstLessonDate !== "string" ||
          !/^\d{4}-\d{2}-\d{2}$/.test(request.firstLessonDate)) {
        throw new Error("Novo vínculo exige origem registrada e primeira aula válida.");
      }
      if (plan.canonicalSource === "other" &&
          (!request.sourceDetail || !String(request.sourceDetail).trim())) {
        throw new Error("Detalhe de origem obrigatório para Outras fontes.");
      }
      args.target_first_lesson_date = request.firstLessonDate;
      args.target_source = plan.canonicalSource;
      args.target_source_detail = plan.canonicalSource === "other"
        ? String(request.sourceDetail).trim().slice(0, 120)
        : null;
    } else {
      if (!Number.isSafeInteger(request.fromClassNumber) ||
          !previousClasses.includes(request.fromClassNumber) ||
          request.fromClassNumber === request.classNumber ||
          request.source != null || request.sourceDetail != null ||
          request.firstLessonDate != null) {
        throw new Error("Turma de origem inválida para transferência.");
      }
      args.target_from_class_number = request.fromClassNumber;
    }

    // This module never calls an RPC. The dedicated backend transaction must be
    // deployed and verified before a separate, confirmed executor is exposed.
    return Object.freeze({
      rpcName: "execute_teacher_academic_change",
      arguments: Object.freeze(args),
      requiresTeacherConfirmation: true,
      executed: false
    });
  }

  const api = Object.freeze({ buildAcademicChangeTransaction });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (browser) browser.TeacherAcademicChangeTransactionPlan = api;
})(typeof window !== "undefined" ? window : null);
