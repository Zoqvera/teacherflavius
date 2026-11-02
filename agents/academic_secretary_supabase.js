(function (browser) {
"use strict";

const plannerModule = typeof module !== "undefined" && module.exports
  ? require("./academic_secretary")
  : browser && browser.TeacherAcademicSecretaryAgent;
if (!plannerModule) throw new Error("O planejador acadêmico não foi carregado.");
const { createAcademicSecretaryAgent } = plannerModule;

const CLASS_TYPE_GROUP = "quintet";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validateClient(client) {
  if (!client || !client.auth || typeof client.auth.getUser !== "function" ||
      typeof client.rpc !== "function" || typeof client.from !== "function") {
    throw new TypeError("Cliente Supabase autenticado obrigatório.");
  }
}

function unwrap(response, operation) {
  if (!response || response.error) {
    throw new Error("Consulta acadêmica indisponível: " + operation + ".");
  }
  return response.data;
}

function requireStudentId(studentId) {
  if (typeof studentId !== "string" || !UUID_PATTERN.test(studentId)) {
    throw new TypeError("Identificador do aluno inválido.");
  }
}

function requireClassNumber(classNumber) {
  if (!Number.isInteger(classNumber) || classNumber < 1) {
    throw new TypeError("Número da turma inválido.");
  }
}

function createSupabaseAcademicReaders(client) {
  validateClient(client);

  async function isTeacherAuthorized() {
    const identity = unwrap(await client.auth.getUser(), "identidade do usuário");
    if (!identity || !identity.user || !identity.user.id) return false;
    const allowed = unwrap(await client.rpc("is_teacher_admin"), "autorização do professor");
    return allowed === true;
  }

  async function requireTeacher() {
    if (await isTeacherAuthorized() !== true) {
      throw new Error("Acesso administrativo não autorizado.");
    }
  }

  async function getStudentSnapshot(studentId) {
    requireStudentId(studentId);
    await requireTeacher();

    const profile = unwrap(await client.from("profiles")
      .select("id,archived")
      .eq("id", studentId)
      .maybeSingle(), "perfil do aluno");
    if (!profile || profile.id !== studentId || typeof profile.archived !== "boolean") {
      throw new Error("Aluno não encontrado ou estado de arquivamento indeterminado.");
    }

    const memberships = unwrap(await client.from("class_students")
      .select("class_number")
      .eq("user_id", studentId), "vínculos do aluno");
    if (!Array.isArray(memberships)) {
      throw new Error("Não foi possível conferir todos os vínculos do aluno.");
    }

    const numbers = memberships.map(item => item && item.class_number);
    if (numbers.some(number => !Number.isInteger(number) || number < 1) ||
        new Set(numbers).size !== numbers.length) {
      throw new Error("Vínculos do aluno apresentam inconsistências.");
    }

    return Object.freeze({
      id: profile.id,
      archived: profile.archived,
      classNumbers: Object.freeze(numbers.sort((a, b) => a - b))
    });
  }

  async function getClassSnapshot(classNumber) {
    requireClassNumber(classNumber);
    await requireTeacher();

    const academicClass = unwrap(await client.from("teacher_classes")
      .select("class_number,class_type,is_active")
      .eq("class_number", classNumber)
      .maybeSingle(), "cadastro da turma");

    if (!academicClass || academicClass.class_number !== classNumber || academicClass.is_active !== true) {
      throw new Error("Turma inexistente ou inativa.");
    }
    if (academicClass.class_type !== CLASS_TYPE_GROUP) {
      throw new Error("Leitura de vagas indisponível para esta modalidade de turma.");
    }

    // The existing database RPC includes enrolled students, pending invites
    // and unexpired seat holds. Do not derive seats from student_count alone.
    const availability = unwrap(await client.rpc("get_public_class_seat_availability"),
      "vagas disponíveis");
    if (!Array.isArray(availability)) {
      throw new Error("Resposta de disponibilidade inválida.");
    }
    const matches = availability.filter(item => item && item.class_number === classNumber);
    if (matches.length !== 1 || !Number.isInteger(matches[0].available_spots) ||
        matches[0].available_spots < 0 ||
        typeof matches[0].sold_out !== "boolean" ||
        matches[0].sold_out !== (matches[0].available_spots === 0)) {
      throw new Error("Disponibilidade de vagas não verificável para a turma.");
    }

    return Object.freeze({
      number: classNumber,
      availableSeats: matches[0].available_spots
    });
  }

  return Object.freeze({ isTeacherAuthorized, getStudentSnapshot, getClassSnapshot });
}

/**
 * Returns a read-only planning service. The client must be scoped to the
 * signed-in teacher, never instantiated here using a service_role key.
 */
function createAcademicSecretarySupabaseService(client) {
  return createAcademicSecretaryAgent(createSupabaseAcademicReaders(client));
}

const academicSecretarySupabaseApi = Object.freeze({
  createSupabaseAcademicReaders,
  createAcademicSecretarySupabaseService
});
if (typeof module !== "undefined" && module.exports) module.exports = academicSecretarySupabaseApi;
if (browser) browser.TeacherAcademicSecretarySupabase = academicSecretarySupabaseApi;
})(typeof window !== "undefined" ? window : null);
