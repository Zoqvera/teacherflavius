(function () {
  "use strict";

  const RPC = Object.freeze({
    teacherStudents: "get_teacher_students",
    studentAccessStatuses: "get_teacher_student_access_statuses",
    studentAccesses: "get_teacher_student_accesses",
    isTeacherAdmin: "is_teacher_admin"
  });

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.getClient !== "function") {
      throw new Error("Dependência inválida do serviço de acessos dos alunos: getClient.");
    }
  }

  function create(dependencies) {
    const deps = dependencies || {};
    assertDependencies(deps);

    function requireClient() {
      const client = deps.getClient();
      if (!client) throw new Error("O cliente Supabase não está disponível.");
      return client;
    }

    async function executeRpc(name, params) {
      const response = await requireClient().rpc(name, params);
      if (response.error) throw response.error;
      return response.data;
    }

    async function isTeacherAdmin() {
      const result = await executeRpc(RPC.isTeacherAdmin);
      return result === true;
    }

    async function getStudents() {
      const data = await executeRpc(RPC.teacherStudents);
      return Array.isArray(data) ? data : [];
    }

    async function getAccessStatuses() {
      const data = await executeRpc(RPC.studentAccessStatuses);
      return Array.isArray(data) ? data : [];
    }

    async function getAccesses(filters) {
      const settings = filters || {};
      const data = await executeRpc(RPC.studentAccesses, {
        target_days: Number(settings.days || 30),
        target_user_id: settings.userId || null
      });
      return Array.isArray(data) ? data : [];
    }

    return Object.freeze({
      isTeacherAdmin: isTeacherAdmin,
      getStudents: getStudents,
      getAccessStatuses: getAccessStatuses,
      getAccesses: getAccesses
    });
  }

  window.StudentAccessService = Object.freeze({
    create: create
  });
})();
