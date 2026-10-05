(function () {
  "use strict";

  const REQUIRED_NOTICE_RPC = "get_my_required_student_policy_notice";
  const ACCEPT_NOTICE_RPC = "accept_my_student_policy_notice";

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.getClient !== "function") {
      throw new Error("Dependência inválida do comunicado obrigatório: getClient.");
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

    async function getRequiredNotice() {
      const response = await requireClient().rpc(REQUIRED_NOTICE_RPC);
      if (response.error) throw response.error;
      return response.data || { required: false };
    }

    async function acceptNotice(policyVersion) {
      const version = String(policyVersion || "").trim();
      if (!version) throw new Error("Versão do comunicado inválida.");

      const response = await requireClient().rpc(ACCEPT_NOTICE_RPC, {
        target_policy_version: version
      });
      if (response.error) throw response.error;
      return response.data || null;
    }

    return Object.freeze({
      getRequiredNotice: getRequiredNotice,
      acceptNotice: acceptNotice
    });
  }

  window.StudentPolicyNoticeService = Object.freeze({
    create: create
  });
})();
