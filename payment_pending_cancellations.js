(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PendingPixCancellations = api;
    const start = function () { api.initialize({ windowRef: root, documentRef: root.document }); };
    if (root.document.readyState === "loading") {
      root.document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const ENDPOINT = "cancel-pending-mercado-pago-payment";
  const CONFIRMATION = "CANCELAR";
  const REFRESH_DELAY_MS = 350;

  function normalizeCandidates(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && typeof row.attempt_id === "string"
        && typeof row.student_name === "string"
        && Number.isFinite(Number(row.amount))
        && row.status !== "approved";
    });
  }

  function selectedMonth(documentRef) {
    const field = documentRef.getElementById("referenceMonth");
    return field && /^\d{4}-\d{2}$/.test(field.value) ? field.value + "-01" : "";
  }

  function currency(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency", currency: "BRL"
    }).format(Number(value) || 0);
  }

  function setMessage(documentRef, message, tone) {
    const target = documentRef.getElementById("pendingPixMessage");
    if (!target) return;
    target.textContent = message || "";
    target.className = "pending-pix-message" + (tone ? " " + tone : "");
    target.hidden = !message;
  }

  function appendText(documentRef, parent, element, className, content) {
    const node = documentRef.createElement(element);
    node.className = className;
    node.textContent = content;
    parent.appendChild(node);
    return node;
  }

  function createCard(documentRef, candidate) {
    const card = documentRef.createElement("article");
    card.className = "pending-pix-card";
    appendText(documentRef, card, "strong", "pending-pix-name", candidate.student_name);
    appendText(documentRef, card, "span", "pending-pix-amount",
      currency(candidate.amount) + " · " + String(candidate.status).toUpperCase());
    appendText(documentRef, card, "span", "pending-pix-detail",
      "Pagamento Mercado Pago: " + String(candidate.provider_payment_id));
    if (candidate.tuition_paid) {
      appendText(documentRef, card, "span", "pending-pix-paid",
        "Mensalidade já quitada: " + currency(candidate.amount_paid)
          + ". Este Pix permanece sem baixa.");
    } else {
      appendText(documentRef, card, "span", "pending-pix-detail",
        "Mensalidade atual: " + currency(candidate.amount_due));
    }
    const button = appendText(documentRef, card, "button", "finance-button pending-pix-cancel",
      "CANCELAR PIX");
    button.type = "button";
    button.dataset.attemptId = candidate.attempt_id;
    button.setAttribute("aria-label", "Cancelar Pix pendente de " + candidate.student_name);
    return card;
  }

  function renderCandidates(documentRef, candidates) {
    const target = documentRef.getElementById("pendingPixList");
    if (!target) return;
    target.replaceChildren();
    if (!candidates.length) {
      appendText(documentRef, target, "p", "pending-pix-empty",
        "Nenhum Pix pendente com cancelamento disponível no mês selecionado.");
      return;
    }
    candidates.forEach(function (candidate) {
      target.appendChild(createCard(documentRef, candidate));
    });
  }

  async function invoke(windowRef, body) {
    const response = await windowRef.Auth.getClient().functions.invoke(ENDPOINT, { body: body });
    if (response.error) {
      const error = response.error;
      let message = error.message || "Falha de comunicação com o servidor.";
      if (error.context && typeof error.context.json === "function") {
        try {
          const details = await error.context.json();
          if (details && typeof details.error === "string") message = details.error;
        } catch (_) {}
      }
      throw new Error(message);
    }
    return response.data && typeof response.data === "object" ? response.data : {};
  }

  function requestConfirmation(windowRef, candidate) {
    const message = "Cancelar apenas o Pix pendente de " + candidate.student_name
      + " no valor de " + currency(candidate.amount) + "?\n\n"
      + "ID do Mercado Pago: " + candidate.provider_payment_id + "\n"
      + "Esta ação não estorna pagamentos aprovados e não modifica mensalidades já quitadas.\n\n"
      + "Digite CANCELAR para confirmar:";
    const confirmation = windowRef.prompt(message, "");
    return typeof confirmation === "string"
      && confirmation.trim().toUpperCase() === CONFIRMATION;
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    const target = documentRef.getElementById("pendingPixList");
    if (!target) return false;
    let candidates = [];
    let busy = false;

    async function refresh() {
      if (!selectedMonth(documentRef)) return;
      try {
        setMessage(documentRef, "Consultando Pix pendentes...", "info");
        const result = await invoke(windowRef, {
          action: "list", reference_month: selectedMonth(documentRef)
        });
        candidates = normalizeCandidates(result.candidates);
        renderCandidates(documentRef, candidates);
        setMessage(documentRef, "", "");
      } catch (error) {
        candidates = [];
        renderCandidates(documentRef, []);
        setMessage(documentRef, "Não foi possível consultar cobranças pendentes: "
          + (error.message || "erro desconhecido"), "error");
      }
    }

    async function cancel(candidate, button) {
      if (busy || !requestConfirmation(windowRef, candidate)) return;
      busy = true;
      button.disabled = true;
      button.textContent = "VERIFICANDO...";
      setMessage(documentRef, "Conferindo cobrança diretamente no Mercado Pago...", "info");
      try {
        const result = await invoke(windowRef, {
          action: "cancel", attempt_id: candidate.attempt_id, confirmation: CONFIRMATION
        });
        await refresh();
        if (result.pending_sync) {
          setMessage(documentRef, "Mercado Pago confirmou o cancelamento; aguarde a conciliação.", "info");
        } else if (result.ok && result.provider_status === "cancelled") {
          setMessage(documentRef, "Pix cancelado e confirmado pelo Mercado Pago.", "success");
        } else {
          setMessage(documentRef, "Cancelamento não confirmado. Consulte o Mercado Pago.", "error");
        }
      } catch (error) {
        setMessage(documentRef, "Cancelamento não confirmado: "
          + (error.message || "falha desconhecida")
          + ". Atualize a lista e confira o pagamento antes de tentar novamente.", "error");
      } finally {
        busy = false;
        button.disabled = false;
        button.textContent = "CANCELAR PIX";
      }
    }

    target.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-attempt-id]");
      if (!button || busy) return;
      const candidate = candidates.find(function (item) {
        return item.attempt_id === button.dataset.attemptId;
      });
      if (candidate) cancel(candidate, button).catch(function (error) {
        console.error("Falha ao cancelar cobrança pendente.", error);
      });
    });
    const refreshButton = documentRef.getElementById("refreshPendingPixButton");
    if (refreshButton) refreshButton.addEventListener("click", refresh);
    const monthField = documentRef.getElementById("referenceMonth");
    if (monthField) monthField.addEventListener("change", function () {
      windowRef.setTimeout(refresh, REFRESH_DELAY_MS);
    });

    // The protected endpoint performs the authoritative admin permission check.
    if (windowRef.Auth && typeof windowRef.Auth.getClient === "function") {
      await refresh();
    } else {
      windowRef.setTimeout(refresh, 650);
    }
    return true;
  }

  return Object.freeze({ normalizeCandidates: normalizeCandidates,
    selectedMonth: selectedMonth, initialize: initialize, renderCandidates: renderCandidates });
});
