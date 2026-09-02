(function () {
  "use strict";

  const RPC_PENDING_TUITIONS = "get_my_pending_tuitions";
  const RECONCILIATION_FUNCTION = "reconcile-mercado-pago-payments";

  function assertDependencies(dependencies) {
    if (!dependencies || typeof dependencies.getClient !== "function") {
      throw new Error("Dependência inválida do serviço de mensalidades: getClient.");
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

    async function getPendingTuitions() {
      const response = await requireClient().rpc(RPC_PENDING_TUITIONS);
      if (response.error) throw response.error;
      return Array.isArray(response.data) ? response.data : [];
    }

    async function reconcilePendingPayments() {
      const response = await requireClient().functions.invoke(RECONCILIATION_FUNCTION, {
        body: {}
      });
      return !response.error;
    }

    return Object.freeze({
      getPendingTuitions: getPendingTuitions,
      reconcilePendingPayments: reconcilePendingPayments
    });
  }

  window.StudentPaymentService = Object.freeze({
    create: create
  });
})();
