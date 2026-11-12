(function () {
  "use strict";

  async function initialize() {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (window.Auth && window.Auth.isConfigured && window.Auth.isConfigured()) break;
      await new Promise(function (resolve) { window.setTimeout(resolve, 150); });
    }
    if (!window.Auth || !window.Auth.isConfigured()) throw new Error("Não foi possível consultar sua matrícula. Atualize a página.");
    const session = await window.Auth.getSession();
    if (!session || !session.user) {
      window.location.replace("/login/?next=" + encodeURIComponent("/matricula-concluida/"));
      return;
    }
    const response = await window.Auth.getClient().rpc("get_my_enrollment_checkout_policy");
    if (response.error || !response.data || typeof response.data.applies !== "boolean") {
      throw new Error("Não foi possível consultar sua matrícula. Atualize a página.");
    }
    const policy = response.data;
    if (!policy.applies) {
      window.location.replace("/area-do-estudante/");
      return;
    }
    document.getElementById("completionMessage").textContent = policy.first_paid
      ? "O pagamento da primeira mensalidade foi registrado."
      : "O professor enviará pelo WhatsApp a chave Pix para o pagamento da primeira mensalidade. Após pagar, aguarde a confirmação do registro.";
    const checkoutMessage = document.getElementById("checkoutMessage");
    checkoutMessage.textContent = "O Mercado Pago poderá ser usado a partir da segunda mensalidade, após dez dias da matrícula e a confirmação do primeiro pagamento.";
    checkoutMessage.hidden = false;
  }

  initialize().catch(function (error) {
    document.getElementById("completionMessage").textContent = error.message || "Não foi possível consultar sua matrícula.";
  });
})();
