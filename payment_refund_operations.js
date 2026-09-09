(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PaymentRefundOperations = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const REFUND_ACTION = "provider-refund";
  const REFUND_CONFIRMATION = "REEMBOLSAR";
  const REFRESH_DELAY_MS = 900;

  function toString(value) {
    return value == null ? "" : String(value);
  }

  function selectedMonth(documentRef) {
    const field = documentRef.getElementById("referenceMonth");
    const value = field && /^\d{4}-\d{2}$/.test(field.value) ? field.value : "";
    return value ? value + "-01" : null;
  }

  function labelForRefundStatus(status) {
    if (status === "provider_accepted" || status === "processing") return "VERIFICAR REEMBOLSO";
    if (status === "failed") return "TENTAR REEMBOLSO";
    return "REEMBOLSAR";
  }

  function normalizeCandidates(rows) {
    const candidates = new Map();
    (Array.isArray(rows) ? rows : []).forEach(function (row) {
      const tuitionId = toString(row && row.tuition_id);
      if (!tuitionId) return;
      candidates.set(tuitionId, {
        tuitionId: tuitionId,
        status: toString(row.refund_status),
        amount: Number(row.amount_paid || 0)
      });
    });
    return candidates;
  }

  function setPageMessage(documentRef, message, type) {
    const element = documentRef.getElementById("pageMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = "page-message" + (type ? " " + type : "");
    element.hidden = !message;
  }

  function decorateButtons(documentRef, candidates) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function") return 0;
    let decorated = 0;
    documentRef.querySelectorAll('button[data-action="reverse"][data-tuition-id]').forEach(function (button) {
      const tuitionId = toString(button.dataset.tuitionId);
      const candidate = candidates.get(tuitionId);
      if (!candidate) return;
      button.dataset.action = REFUND_ACTION;
      button.dataset.refundStatus = candidate.status;
      button.textContent = labelForRefundStatus(candidate.status);
      button.title = "Reembolso integral pelo Mercado Pago";
      button.setAttribute("aria-label", "Reembolsar integralmente o pagamento pelo Mercado Pago");
      decorated += 1;
    });
    return decorated;
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef, documentRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (
        windowRef.Auth
        && typeof windowRef.Auth.getClient === "function"
        && documentRef.getElementById("tuitionTableBody")
        && documentRef.getElementById("referenceMonth")
      ) return true;
      await wait(150, windowRef);
    }
    return false;
  }

  async function loadCandidates(windowRef, documentRef) {
    const response = await windowRef.Auth.getClient().rpc("get_teacher_mercado_pago_refund_candidates", {
      target_reference_month: selectedMonth(documentRef)
    });
    if (response.error) throw response.error;
    return normalizeCandidates(response.data);
  }

  async function invokeRefund(windowRef, tuitionId, reason) {
    const response = await windowRef.Auth.getClient().functions.invoke("refund-mercado-pago-payment", {
      body: {
        tuition_id: tuitionId,
        reason: reason,
        confirmation: REFUND_CONFIRMATION
      }
    });
    if (response.error) throw response.error;
    return response.data && typeof response.data === "object" ? response.data : {};
  }

  function requestConfirmation(windowRef) {
    const reason = windowRef.prompt(
      "Motivo do reembolso (opcional). Clique em Cancelar para desistir:",
      ""
    );
    if (reason === null) return null;

    const confirmation = windowRef.prompt(
      "Este reembolso devolverá integralmente o valor ao aluno pelo Mercado Pago. Digite REEMBOLSAR para confirmar:",
      ""
    );
    if (toString(confirmation).trim().toUpperCase() !== REFUND_CONFIRMATION) return null;
    return toString(reason).trim().slice(0, 500);
  }

  async function requestRefund(dependencies, tuitionId, button) {
    const windowRef = dependencies.windowRef;
    const documentRef = dependencies.documentRef;
    const reason = requestConfirmation(windowRef);
    if (reason === null) return false;

    const previousLabel = button.textContent;
    button.disabled = true;
    button.textContent = "PROCESSANDO...";
    setPageMessage(documentRef, "Solicitando reembolso integral ao Mercado Pago...", "info");

    try {
      const result = await invokeRefund(windowRef, tuitionId, reason);
      if (result.pending === true) {
        setPageMessage(
          documentRef,
          "O Mercado Pago aceitou o reembolso. A confirmação final está sendo reconciliada automaticamente.",
          "info"
        );
      } else {
        setPageMessage(
          documentRef,
          "Reembolso integral confirmado pelo Mercado Pago e conciliado com a mensalidade.",
          "success"
        );
      }

      const refreshButton = documentRef.getElementById("refreshMonthButton");
      if (refreshButton && typeof refreshButton.click === "function") {
        windowRef.setTimeout(function () { refreshButton.click(); }, 150);
      }
      return true;
    } catch (error) {
      setPageMessage(
        documentRef,
        "Não foi possível concluir o reembolso com segurança: " + (error.message || "erro desconhecido") +
          ". Nenhuma reversão local será feita sem confirmação do Mercado Pago.",
        "error"
      );
      return false;
    } finally {
      button.disabled = false;
      button.textContent = previousLabel;
    }
  }

  function bindTableClick(dependencies) {
    const tableBody = dependencies.documentRef.getElementById("tuitionTableBody");
    if (!tableBody || tableBody.dataset.refundOperationsBound) return;
    tableBody.dataset.refundOperationsBound = "true";
    tableBody.addEventListener("click", function (event) {
      const button = event.target.closest('button[data-action="' + REFUND_ACTION + '"]');
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      requestRefund(dependencies, toString(button.dataset.tuitionId), button).catch(function (error) {
        console.error("Falha inesperada ao solicitar reembolso.", error);
      });
    }, true);
  }

  function observeTable(dependencies, getCandidates) {
    const tableBody = dependencies.documentRef.getElementById("tuitionTableBody");
    const MutationObserverRef = dependencies.windowRef.MutationObserver;
    if (!tableBody || !MutationObserverRef) return null;
    const observer = new MutationObserverRef(function () {
      decorateButtons(dependencies.documentRef, getCandidates());
    });
    observer.observe(tableBody, { childList: true, subtree: true });
    return observer;
  }

  function bindRefreshEvents(dependencies, refreshCandidates) {
    const documentRef = dependencies.documentRef;
    const windowRef = dependencies.windowRef;
    const monthField = documentRef.getElementById("referenceMonth");
    const refreshButton = documentRef.getElementById("refreshMonthButton");

    if (monthField && !monthField.dataset.refundOperationsBound) {
      monthField.dataset.refundOperationsBound = "true";
      monthField.addEventListener("change", function () {
        windowRef.setTimeout(function () { refreshCandidates().catch(function () {}); }, 300);
      });
    }
    if (refreshButton && !refreshButton.dataset.refundOperationsBound) {
      refreshButton.dataset.refundOperationsBound = "true";
      refreshButton.addEventListener("click", function () {
        windowRef.setTimeout(function () { refreshCandidates().catch(function () {}); }, REFRESH_DELAY_MS);
      });
    }
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    const ready = await waitForDependencies(windowRef, documentRef);
    if (!ready) return false;

    let candidates = new Map();
    const refreshCandidates = async function () {
      candidates = await loadCandidates(windowRef, documentRef);
      decorateButtons(documentRef, candidates);
      return candidates;
    };

    bindTableClick({ windowRef: windowRef, documentRef: documentRef });
    observeTable({ windowRef: windowRef, documentRef: documentRef }, function () { return candidates; });
    bindRefreshEvents({ windowRef: windowRef, documentRef: documentRef }, refreshCandidates);

    try {
      await refreshCandidates();
    } catch (error) {
      console.warn("Não foi possível carregar os pagamentos elegíveis a reembolso.", error);
    }
    return true;
  }

  return Object.freeze({
    REFUND_ACTION: REFUND_ACTION,
    labelForRefundStatus: labelForRefundStatus,
    normalizeCandidates: normalizeCandidates,
    decorateButtons: decorateButtons,
    initialize: initialize
  });
});
