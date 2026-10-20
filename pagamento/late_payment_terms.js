(function () {
  "use strict";

  const POLICY_VERSION = "2026-10-20-v1";
  const MAX_READINESS_CHECKS = 25;

  const byId = (id) => document.getElementById(id);

  function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function getAuthenticatedClient() {
    for (let check = 0; check < MAX_READINESS_CHECKS; check += 1) {
      if (window.Auth && typeof window.Auth.getClient === "function") {
        const session = await window.Auth.getSession();
        if (session && session.user) return window.Auth.getClient();
        return null;
      }
      await delay(200);
    }
    return null;
  }

  function setFeedback(text, isError) {
    const element = byId("latePaymentTermsStatus");
    element.textContent = text;
    element.classList.toggle("error", Boolean(isError));
  }

  async function mountConsent() {
    const section = byId("latePaymentTermsConsent");
    const checkbox = byId("latePaymentTermsCheckbox");
    const button = byId("latePaymentTermsAcceptButton");

    if (!section || !checkbox || !button) return;

    const client = await getAuthenticatedClient();
    if (!client) return;

    // Older schema deployments simply omit this optional panel.
    const { data, error } = await client.rpc("get_my_late_payment_terms");
    if (error || !data || data.accepted || !data.active_student) return;

    section.hidden = false;
    checkbox.addEventListener("change", function () {
      button.disabled = !checkbox.checked;
    });

    button.addEventListener("click", async function () {
      if (!checkbox.checked || button.disabled) return;
      button.disabled = true;
      setFeedback("Registrando concordância...", false);
      try {
        const response = await client.rpc("accept_my_late_payment_terms", {
          target_policy_version: POLICY_VERSION
        });
        if (response.error) throw response.error;
        if (!response.data || response.data.ok !== true) {
          throw new Error("O aceite não pôde ser confirmado.");
        }
        checkbox.disabled = true;
        window.dispatchEvent(new Event("latepaymenttermsaccepted"));
        setFeedback(
          "Concordância registrada. Os valores das mensalidades atuais não foram modificados.",
          false
        );
      } catch (failure) {
        setFeedback(
          failure && failure.message
            ? failure.message
            : "Não foi possível registrar sua concordância.",
          true
        );
        button.disabled = !checkbox.checked;
      }
    });
  }

  function start() {
    mountConsent().catch(function (error) {
      console.warn("O comunicado financeiro não pôde ser carregado:", error);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
