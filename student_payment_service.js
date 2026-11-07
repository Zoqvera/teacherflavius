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
      const tuitions = Array.isArray(response.data) ? response.data : [];
      return Promise.all(tuitions.map(async function (tuition) {
        const quotation = await requireClient().rpc("get_my_financial_responsibility_quote", {
          target_tuition_id: tuition.tuition_id
        });
        if (quotation.error || !quotation.data) {
          throw new Error("Não foi possível calcular o valor da mensalidade com o responsável financeiro.");
        }
        const total = Number(quotation.data.total);
        if (!Number.isFinite(total) || total <= 0) {
          throw new Error("Valor da mensalidade inválido.");
        }
        return Object.assign({}, tuition, { amount_due: total });
      }));
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
