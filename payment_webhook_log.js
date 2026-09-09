(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PaymentWebhookLog = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PANEL_ID = "paymentWebhookLog";
  const STYLE_ID = "paymentWebhookLogStyles";
  const STATUS_LABELS = Object.freeze({
    received: "Recebido",
    processing: "Processando",
    processed: "Processado",
    ignored: "Ignorado",
    failed: "Falha"
  });

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalizeEvent(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    return {
      eventId: String(source.event_id || ""),
      providerPaymentId: String(source.provider_payment_id || ""),
      eventType: String(source.event_type || ""),
      action: String(source.action || ""),
      status: String(source.status || "received"),
      deliveryCount: toNumber(source.delivery_count),
      processingAttempts: toNumber(source.processing_attempts),
      replayCount: toNumber(source.replay_count),
      lastError: String(source.last_error || ""),
      firstReceivedAt: String(source.first_received_at || ""),
      lastReceivedAt: String(source.last_received_at || ""),
      processedAt: String(source.processed_at || "")
    };
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(date);
  }

  function isReplayable(event) {
    return event.eventType === "payment" &&
      !!event.providerPaymentId &&
      ["received", "processed", "failed"].includes(event.status);
  }

  function statusMarkup(event) {
    const label = STATUS_LABELS[event.status] || event.status || "Recebido";
    const error = event.lastError
      ? '<small class="webhook-log-error">' + escapeHtml(event.lastError) + '</small>'
      : "";
    return '<span class="webhook-log-status ' + escapeHtml(event.status) + '">' +
      escapeHtml(label) + '</span>' + error;
  }

  function actionMarkup(event) {
    if (!isReplayable(event)) return "—";
    return '<button class="webhook-log-replay" type="button" data-webhook-event-id="' +
      escapeHtml(event.eventId) + '">REPROCESSAR</button>';
  }

  function buildRows(events) {
    if (!events.length) {
      return '<tr><td colspan="7" class="webhook-log-empty">Nenhum webhook válido registrado ainda.</td></tr>';
    }

    return events.map(function (event) {
      return '<tr>' +
        '<td>' + escapeHtml(formatDateTime(event.lastReceivedAt)) + '</td>' +
        '<td><code>' + escapeHtml(event.providerPaymentId || "—") + '</code></td>' +
        '<td>' + escapeHtml(event.action || event.eventType || "—") + '</td>' +
        '<td>' + statusMarkup(event) + '</td>' +
        '<td>' + escapeHtml(event.deliveryCount) + '</td>' +
        '<td>' + escapeHtml(event.replayCount) + '</td>' +
        '<td>' + actionMarkup(event) + '</td>' +
      '</tr>';
    }).join("");
  }

  function buildMarkup(events) {
    const normalizedEvents = (Array.isArray(events) ? events : []).map(normalizeEvent);
    return '<div class="webhook-log-header">' +
      '<div><h2>Webhooks do Mercado Pago</h2>' +
      '<p>Trilha técnica persistente. O replay consulta novamente o estado atual no gateway.</p></div>' +
      '<span class="webhook-log-count">' + escapeHtml(normalizedEvents.length) + ' recente(s)</span>' +
    '</div>' +
    '<div id="paymentWebhookActionMessage" class="webhook-log-message" hidden></div>' +
    '<div class="webhook-log-table-wrap"><table class="webhook-log-table">' +
      '<thead><tr><th>Recebido</th><th>Pagamento</th><th>Evento</th><th>Status</th><th>Entregas</th><th>Replays</th><th>Ação</th></tr></thead>' +
      '<tbody>' + buildRows(normalizedEvents) + '</tbody>' +
    '</table></div>';
  }

  function injectStyles(documentRef) {
    if (documentRef.getElementById(STYLE_ID)) return;
    const style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".payment-webhook-log-panel{margin-top:22px}",
      ".webhook-log-header{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:16px}",
      ".webhook-log-header h2{color:#f1f5f9;font-size:22px;margin:0 0 6px}",
      ".webhook-log-header p{color:#94a3b8;font-size:13px;line-height:1.5;margin:0}",
      ".webhook-log-count{background:rgba(129,140,248,.14);border:1px solid rgba(129,140,248,.32);border-radius:999px;color:#c4b5fd;flex-shrink:0;font-size:11px;font-weight:700;padding:8px 11px}",
      ".webhook-log-table-wrap{border:1px solid rgba(255,255,255,.08);border-radius:14px;overflow-x:auto}",
      ".webhook-log-table{border-collapse:collapse;min-width:850px;width:100%}",
      ".webhook-log-table th,.webhook-log-table td{border-bottom:1px solid rgba(255,255,255,.07);padding:11px 12px;text-align:left;vertical-align:middle}",
      ".webhook-log-table th{background:rgba(15,23,42,.62);color:#94a3b8;font-size:10px;letter-spacing:.07em;text-transform:uppercase}",
      ".webhook-log-table td{color:#cbd5e1;font-size:12px}",
      ".webhook-log-table code{color:#c4b5fd;font-size:11px}",
      ".webhook-log-status{border:1px solid rgba(148,163,184,.3);border-radius:999px;display:inline-flex;font-size:10px;font-weight:700;padding:5px 8px}",
      ".webhook-log-status.processed{border-color:rgba(52,211,153,.38);color:#a7f3d0}",
      ".webhook-log-status.failed{border-color:rgba(248,113,113,.4);color:#fca5a5}",
      ".webhook-log-status.processing{border-color:rgba(251,191,36,.4);color:#fde68a}",
      ".webhook-log-status.ignored{color:#94a3b8}",
      ".webhook-log-error{color:#fca5a5;display:block;font-size:10px;margin-top:5px}",
      ".webhook-log-replay{background:rgba(129,140,248,.14);border:1px solid rgba(129,140,248,.38);border-radius:9px;color:#c4b5fd;cursor:pointer;font-family:Georgia,serif;font-size:10px;font-weight:700;padding:7px 9px}",
      ".webhook-log-replay:disabled{cursor:not-allowed;opacity:.55}",
      ".webhook-log-message{border:1px solid rgba(129,140,248,.28);border-radius:10px;color:#cbd5e1;font-size:12px;margin-bottom:12px;padding:9px 11px}",
      ".webhook-log-message.success{background:rgba(16,185,129,.1);color:#a7f3d0}",
      ".webhook-log-message.error{background:rgba(239,68,68,.1);color:#fca5a5}",
      ".webhook-log-empty{color:#94a3b8!important;text-align:center!important}",
      "@media(max-width:620px){.webhook-log-header{flex-direction:column}.webhook-log-count{align-self:flex-start}}"
    ].join("");
    documentRef.head.appendChild(style);
  }

  function mount(documentRef) {
    let section = documentRef.getElementById(PANEL_ID);
    if (section) return section;

    const dashboard = documentRef.getElementById("paymentOperationsDashboard");
    const summaryGrid = documentRef.querySelector(".summary-grid");
    const anchor = dashboard || summaryGrid;
    if (!anchor || !anchor.parentNode) return null;

    section = documentRef.createElement("section");
    section.id = PANEL_ID;
    section.className = "finance-panel payment-webhook-log-panel";
    section.innerHTML = '<div class="webhook-log-empty">Carregando webhooks do Mercado Pago...</div>';
    anchor.parentNode.insertBefore(section, anchor.nextSibling);
    return section;
  }

  function setMessage(documentRef, message, type) {
    const element = documentRef.getElementById("paymentWebhookActionMessage");
    if (!element) return;
    element.textContent = message || "";
    element.className = "webhook-log-message" + (type ? " " + type : "");
    element.hidden = !message;
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef, documentRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (windowRef.Auth && typeof windowRef.Auth.getClient === "function" && documentRef.querySelector(".summary-grid")) {
        return true;
      }
      await wait(150, windowRef);
    }
    return false;
  }

  async function loadEvents(client) {
    const response = await client.rpc("get_teacher_payment_webhook_events", { target_limit: 15 });
    if (response.error) throw response.error;
    return Array.isArray(response.data) ? response.data : [];
  }

  async function refresh(dependencies) {
    const section = mount(dependencies.documentRef);
    if (!section) return [];
    const client = dependencies.windowRef.Auth.getClient();
    const events = await loadEvents(client);
    section.innerHTML = buildMarkup(events);
    return events.map(normalizeEvent);
  }

  async function replayEvent(dependencies, eventId, button) {
    const windowRef = dependencies.windowRef;
    const documentRef = dependencies.documentRef;
    if (typeof windowRef.confirm === "function" && !windowRef.confirm("Reconsultar este pagamento no Mercado Pago e reaplicar o estado atual?")) {
      return;
    }

    if (button) button.disabled = true;
    setMessage(documentRef, "Reconsultando o pagamento no Mercado Pago...", "");
    try {
      const response = await windowRef.Auth.getClient().functions.invoke("replay-mercado-pago-webhook", {
        body: { event_id: eventId }
      });
      if (response.error) throw response.error;
      await refresh(dependencies);
      setMessage(documentRef, "Webhook reprocessado com o estado atual do Mercado Pago.", "success");
    } catch (error) {
      setMessage(documentRef, "Não foi possível reprocessar o webhook: " + (error.message || "erro desconhecido"), "error");
      if (button) button.disabled = false;
    }
  }

  function bindReplay(dependencies) {
    const section = mount(dependencies.documentRef);
    if (!section || section.dataset.replayBound) return;
    section.dataset.replayBound = "true";
    section.addEventListener("click", function (event) {
      const button = event.target.closest("button[data-webhook-event-id]");
      if (!button) return;
      replayEvent(dependencies, button.dataset.webhookEventId, button);
    });
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;

    injectStyles(documentRef);
    const ready = await waitForDependencies(windowRef, documentRef);
    if (!ready) return false;

    bindReplay({ windowRef: windowRef, documentRef: documentRef });
    try {
      await refresh({ windowRef: windowRef, documentRef: documentRef });
    } catch (error) {
      const section = mount(documentRef);
      if (section) section.innerHTML = '<div class="webhook-log-message error">Não foi possível carregar o histórico de webhooks.</div>';
      console.warn("Não foi possível carregar o histórico de webhooks do Mercado Pago.", error);
    }
    return true;
  }

  return Object.freeze({
    buildMarkup: buildMarkup,
    formatDateTime: formatDateTime,
    isReplayable: isReplayable,
    normalizeEvent: normalizeEvent,
    initialize: initialize,
    refresh: refresh
  });
});
