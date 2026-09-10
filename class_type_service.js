(function () {
  "use strict";

  const RPC_GET_CLASS_TYPES = "get_teacher_classes_with_type";

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.getClient !== "function") {
      throw new Error("Dependência inválida do serviço de tipos de turma: getClient.");
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

    async function getClassTypes() {
      const response = await requireClient().rpc(RPC_GET_CLASS_TYPES);
      if (response.error) throw response.error;
      return Array.isArray(response.data) ? response.data : [];
    }

    return Object.freeze({
      getClassTypes: getClassTypes
    });
  }

  window.ClassTypeService = Object.freeze({
    create: create
  });
})();
