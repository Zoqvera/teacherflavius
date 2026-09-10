(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PaymentCreationControl = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PANEL_ID = "paymentCreationControlPanel";
  const ACTION_BUTTON_ID = "paymentCreationControlButton";
  const BLOCK_CONFIRMATION = "BLOQUEAR";
  const ENABLE_CONFIRMATION = "REATIVAR";

  function toString(value) {
    return value == null ? "" : String(value);
  }

  function escapeHtml(value) {
    return toString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeControl(value) {
    const control = value && typeof value === "object" ? value : {};
    return Object.freeze({
      enabled: control.enabled !== false,
      reason: toString(control.reason).trim().slice(0, 500),
      updatedAt: toString(control.updated_at).trim()
    });
  }

  function statusLabel(control) {
    return control.enabled ? "NOVAS COBRANÇAS ATIVAS" : "NOVAS COBRANÇAS BLOQUEADAS";
  }

  function actionLabel(control) {
    return control.enabled ? "BLOQUEAR NOVAS COBRANÇAS" : "REATIVAR NOVAS COBRANÇAS";
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "não informado";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function setPageMessage(documentRef, message, type) {
    const element = documentRef.getElementById("pageMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = "page-message" + (type ? " " + type : "");
    element.hidden = !message;
  }

  function ensurePanel(documentRef) {
    let panel = documentRef.getElementById(PANEL_ID);
    if (panel) return panel;

    const content = documentRef.getElementById("financialContent");
    const pageMessage = documentRef.getElementById("pageMessage");
    if (!content || !pageMessage || typeof documentRef.createElement !== "function") return null;

    panel = documentRef.createElement("section");
    panel.id = PANEL_ID;
    panel.className = "finance-panel";
    panel.setAttribute("aria-labelledby", PANEL_ID + "Title");
    pageMessage.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function renderControl(documentRef, rawControl) {
    const control = normalizeControl(rawControl);
    const panel = ensurePanel(documentRef);
    if (!panel) return control;

    const statusClass = control.enabled ? "status-paid" : "status-overdue";
    const reason = control.reason || (control.enabled
      ? "O checkout pode criar novas cobranças no Mercado Pago."
      : "Bloqueio operacional ativo.");

    panel.innerHTML = [
      '<div class="panel-header">',
      '<div><h2 id="' + PANEL_ID + 'Title">Controle de novas cobranças</h2>',
      '<p>Kill switch operacional. Webhooks, reconciliação, reembolsos e chargebacks continuam funcionando quando novas cobranças estão bloqueadas.</p></div>',
      '<span class="status-pill ' + statusClass + '">' + escapeHtml(statusLabel(control)) + '</span>',
      '</div>',
      '<p><strong>Estado:</strong> ' + escapeHtml(reason) + '</p>',
      '<p><strong>Última alteração:</strong> ' + escapeHtml(formatTimestamp(control.updatedAt)) + '</p>',
      '<button id="' + ACTION_BUTTON_ID + '" class="finance-button' + (control.enabled ? '' : ' primary') + '" type="button">' +
        escapeHtml(actionLabel(control)) + '</button>'
    ].join("");

    panel.dataset.enabled = control.enabled ? "true" : "false";
    return control;
  }

  async function invokeControl(windowRef, body) {
    const response = await windowRef.Auth.getClient().functions.invoke("manage-payment-creation-control", { body: body });
    if (response.error) throw response.error;
    const payload = response.data && typeof response.data === "object" ? response.data : {};
    return normalizeControl(payload.control);
  }

  function loadControl(windowRef) {
    return invokeControl(windowRef, { action: "get" });
  }

  function saveControl(windowRef, enabled, reason) {
    return invokeControl(windowRef, {
      action: "set",
      enabled: enabled,
      reason: reason || null
    });
  }

  function requestTransition(windowRef, control) {
    if (control.enabled) {
      const reason = windowRef.prompt(
        "Informe o motivo do bloqueio de novas cobranças (mínimo de 5 caracteres). Clique em Cancelar para desistir:",
        ""
      );
      if (reason === null || toString(reason).trim().length < 5) return null;

      const confirmation = windowRef.prompt(
        "O checkout deixará de criar novas cobranças, mas os processos de recuperação continuarão ativos. Digite BLOQUEAR para confirmar:",
        ""
      );
      if (toString(confirmation).trim().toUpperCase() !== BLOCK_CONFIRMATION) return null;
      return { enabled: false, reason: toString(reason).trim().slice(0, 500) };
    }

    const confirmation = windowRef.prompt(
      "Novas cobranças voltarão a ser criadas no Mercado Pago. Digite REATIVAR para confirmar:",
      ""
    );
    if (toString(confirmation).trim().toUpperCase() !== ENABLE_CONFIRMATION) return null;
    return { enabled: true, reason: "Novas cobranças reativadas pelo professor." };
  }

  async function applyTransition(dependencies, currentControl) {
    const windowRef = dependencies.windowRef;
    const documentRef = dependencies.documentRef;
    const transition = requestTransition(windowRef, currentControl);
    if (!transition) return currentControl;

    const button = documentRef.getElementById(ACTION_BUTTON_ID);
    if (button) {
      button.disabled = true;
      button.textContent = "PROCESSANDO...";
    }

    try {
      const updated = await saveControl(windowRef, transition.enabled, transition.reason);
      renderControl(documentRef, updated);
      setPageMessage(
        documentRef,
        updated.enabled
          ? "Novas cobranças foram reativadas."
          : "Novas cobranças foram bloqueadas. Pagamentos já existentes continuam sendo conciliados normalmente.",
        updated.enabled ? "success" : "info"
      );
      return updated;
    } catch (error) {
      setPageMessage(
        documentRef,
        "Não foi possível alterar o controle de novas cobranças: " + (error.message || "erro desconhecido") + ".",
        "error"
      );
      throw error;
    } finally {
      const currentButton = documentRef.getElementById(ACTION_BUTTON_ID);
      if (currentButton) currentButton.disabled = false;
    }
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef, documentRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (
        windowRef.Auth
        && typeof windowRef.Auth.getClient === "function"
        && documentRef.getElementById("financialContent")
        && documentRef.getElementById("pageMessage")
      ) return true;
      await wait(150, windowRef);
    }
    return false;
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;

    const ready = await waitForDependencies(windowRef, documentRef);
    if (!ready) return false;

    let control;
    try {
      control = await loadControl(windowRef);
      renderControl(documentRef, control);
    } catch (error) {
      console.warn("Não foi possível carregar o controle de novas cobranças.", error);
      return false;
    }

    const panel = documentRef.getElementById(PANEL_ID);
    if (!panel || panel.dataset.controlBound) return true;
    panel.dataset.controlBound = "true";
    panel.addEventListener("click", function (event) {
      const button = event.target.closest("#" + ACTION_BUTTON_ID);
      if (!button) return;
      applyTransition({ windowRef: windowRef, documentRef: documentRef }, control)
        .then(function (updated) { control = updated; })
        .catch(function () {});
    });

    return true;
  }

  return Object.freeze({
    PANEL_ID: PANEL_ID,
    BLOCK_CONFIRMATION: BLOCK_CONFIRMATION,
    ENABLE_CONFIRMATION: ENABLE_CONFIRMATION,
    normalizeControl: normalizeControl,
    statusLabel: statusLabel,
    actionLabel: actionLabel,
    renderControl: renderControl,
    requestTransition: requestTransition,
    initialize: initialize
  });
});
