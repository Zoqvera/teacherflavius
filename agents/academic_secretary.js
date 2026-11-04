(function (browser) {
"use strict";

/**
 * Read-only planning boundary for teacher academic operations.
 * The injected readers must enforce backend teacher authentication.
 * No database writes or credentials are used by this module.
 */
const ACTIONS = Object.freeze({
  INSPECT_STUDENT: "inspect_student",
  NEW_LINK: "new_link",
  TRANSFER: "transfer",
  ARCHIVE: "archive",
  UNARCHIVE: "unarchive"
});

const SOURCE_ALIASES = Object.freeze({
  instagram: "instagram",
  chatgpt: "chatgpt",
  google: "google",
  referral: "referral",
  indicacao: "referral",
  facebook: "facebook",
  getninjas: "getninjas",
  other: "other",
  outras: "other",
  unknown: "unknown",
  naolembro: "unknown"
});

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isValidDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function normalizeSource(value) {
  if (typeof value !== "string") return null;
  const token = value.trim().toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return SOURCE_ALIASES[token] || null;
}

function validateDependencies(dependencies) {
  for (const key of ["isTeacherAuthorized", "getStudentSnapshot", "getClassSnapshot"]) {
    if (!dependencies || typeof dependencies[key] !== "function") {
      throw new TypeError("Dependência obrigatória ausente: " + key);
    }
  }
}

function normalizeStudent(student, studentId) {
  if (!student || student.id !== studentId || typeof student.archived !== "boolean" ||
      !Array.isArray(student.classNumbers) || !student.classNumbers.every(isPositiveInteger)) {
    throw new Error("Retrato acadêmico do aluno incompleto ou inconsistente.");
  }
  return student;
}

function normalizeClass(academicClass, classNumber) {
  if (!academicClass || academicClass.number !== classNumber ||
      !Number.isInteger(academicClass.availableSeats) || academicClass.availableSeats < 0) {
    throw new Error("Disponibilidade da turma não foi verificada.");
  }
  return academicClass;
}

function createPlan(action, studentId) {
  return {
    action,
    studentId,
    status: "ready_for_review",
    missingFields: [],
    blockers: [],
    steps: [],
    requiresAtomicExecution: false,
    readOnly: true
  };
}

function planNewLink(plan, request, student, academicClass) {
  if (student.archived) plan.blockers.push("Aluno arquivado: desarquive antes de vincular.");
  if (student.classNumbers.includes(request.classNumber)) {
    plan.blockers.push("O aluno já está vinculado à turma de destino.");
  }
  if (student.classNumbers.length >= 2) {
    plan.blockers.push("O aluno já possui dois vínculos: utilize transferência se deseja substituí-los.");
  }
  if (academicClass.availableSeats === 0) {
    plan.blockers.push("Turma sem vagas verificadas. Alteração de capacidade requer operação própria.");
  }

  if (!request.source) {
    plan.missingFields.push("source");
  } else {
    const source = normalizeSource(request.source);
    if (!source) plan.blockers.push("Origem inválida: selecione uma opção do catálogo de aquisição.");
    if (source === "other" && (!request.sourceDetail || !String(request.sourceDetail).trim())) {
      plan.missingFields.push("sourceDetail");
    }
    if (source && String(request.sourceDetail || "").length > 120) {
      plan.blockers.push("O detalhamento da origem deve ter no máximo 120 caracteres.");
    }
    if (source) plan.canonicalSource = source;
  }

  if (!request.firstLessonDate) {
    plan.missingFields.push("firstLessonDate");
  } else if (!isValidDate(request.firstLessonDate)) {
    plan.blockers.push("Data da primeira aula inválida (AAAA-MM-DD).");
  }

  plan.requiresAtomicExecution = true;
  plan.steps = [
    "Revalidar capacidade, elegibilidade e vínculos no backend, dentro da operação autorizada.",
    "Registrar origem pela RPC set_teacher_student_acquisition, preservando histórico.",
    "Registrar a primeira aula no vínculo acadêmico e efetivar a inclusão pelo fluxo autorizado.",
    "Conferir vínculo, origem e data da primeira aula após a operação."
  ];
}

function planTransfer(plan, request, student, academicClass) {
  if (student.archived) plan.blockers.push("Aluno arquivado: transferência indisponível.");
  if (academicClass.availableSeats === 0 && !student.classNumbers.includes(request.classNumber)) {
    plan.blockers.push("Turma de destino sem vaga verificada.");
  }
  if (!isPositiveInteger(request.fromClassNumber)) {
    plan.missingFields.push("fromClassNumber");
  } else if (!student.classNumbers.includes(request.fromClassNumber)) {
    plan.blockers.push("Turma de origem não consta entre os vínculos do aluno.");
  }
  if (student.classNumbers.includes(request.classNumber)) {
    plan.blockers.push("O aluno já está vinculado à turma de destino.");
  }
  if (request.fromClassNumber === request.classNumber) {
    plan.blockers.push("A turma de origem e a de destino devem ser diferentes.");
  }
  plan.requiresAtomicExecution = true;
  plan.steps = [
    "Revalidar vínculos e capacidade no backend antes da transferência.",
    "Executar transferência e remapeamento dos créditos de aulas pela lógica oficial, como operação consistente.",
    "Verificar datas dos créditos e confirmar que outros vínculos válidos foram preservados."
  ];
}

function planArchive(plan, student) {
  if (student.archived) plan.blockers.push("Aluno já está arquivado.");
  plan.requiresAtomicExecution = true;
  plan.steps = [
    "Executar a RPC archive_teacher_student com autorização administrativa.",
    "Validar desvinculação de todas as turmas e suspensão das próximas cobranças.",
    "Preservar histórico financeiro e acadêmico."
  ];
}

function planUnarchive(plan, student) {
  if (!student.archived) plan.blockers.push("Aluno não está arquivado.");
  plan.requiresAtomicExecution = true;
  plan.steps = [
    "Executar a RPC unarchive_teacher_student com autorização administrativa.",
    "Validar reativação das próximas mensalidades, sem duplicar cobranças anteriores.",
    "Não criar vínculo de turma automaticamente."
  ];
}

function finalizePlan(plan) {
  if (plan.blockers.length) plan.status = "blocked";
  else if (plan.missingFields.length) plan.status = "needs_input";
  plan.missingFields = Object.freeze(plan.missingFields);
  plan.blockers = Object.freeze(plan.blockers);
  plan.steps = Object.freeze(plan.steps);
  return Object.freeze(plan);
}

function createAcademicSecretaryAgent(dependencies) {
  validateDependencies(dependencies);
  async function plan(request) {
    if (!request || !Object.values(ACTIONS).includes(request.action) ||
        typeof request.studentId !== "string" || !request.studentId.trim()) {
      throw new TypeError("Solicitação acadêmica inválida.");
    }
    if (await dependencies.isTeacherAuthorized() !== true) {
      throw new Error("Acesso administrativo não autorizado.");
    }

    const student = normalizeStudent(await dependencies.getStudentSnapshot(request.studentId), request.studentId);
    const result = createPlan(request.action, request.studentId);
    result.snapshot = Object.freeze({
      archived: student.archived,
      classNumbers: Object.freeze([...student.classNumbers])
    });
    if (request.action === ACTIONS.INSPECT_STUDENT) {
      result.steps = ["Consulta concluída sem qualquer alteração."];
      return finalizePlan(result);
    }
    if (request.action === ACTIONS.ARCHIVE) planArchive(result, student);
    if (request.action === ACTIONS.UNARCHIVE) planUnarchive(result, student);
    if ([ACTIONS.NEW_LINK, ACTIONS.TRANSFER].includes(request.action)) {
      if (!isPositiveInteger(request.classNumber)) throw new TypeError("Turma de destino inválida.");
      const targetClass = normalizeClass(await dependencies.getClassSnapshot(request.classNumber), request.classNumber);
      if (request.action === ACTIONS.NEW_LINK) planNewLink(result, request, student, targetClass);
      else planTransfer(result, request, student, targetClass);
    }
    return finalizePlan(result);
  }
  return Object.freeze({ plan });
}

const academicSecretaryApi = Object.freeze({ ACTIONS, createAcademicSecretaryAgent });
if (typeof module !== "undefined" && module.exports) module.exports = academicSecretaryApi;
if (browser) browser.TeacherAcademicSecretaryAgent = academicSecretaryApi;
})(typeof window !== "undefined" ? window : null);
