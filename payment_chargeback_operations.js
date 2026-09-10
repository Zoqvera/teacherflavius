(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PaymentChargebackOperations = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const PANEL_ID = "paymentChargebackOperations";
  const STYLE_ID = "paymentChargebackOperationsStyles";
  const REFRESH_DELAY_MS = 900;

  function toString(value) {
    return value == null ? "" : String(value);
  }

  function toNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function selectedMonth(documentRef) {
    const field = documentRef.getElementById("referenceMonth");
    const value = field && /^\d{4}-\d{2}$/.test(field.value) ? field.value : "";
    return value ? value + "-01" : null;
  }

  function statusMeta(status) {
    if (status === "won") return { label: "CONTESTAÇÃO GANHA", tone: "won" };
    if (status === "lost") return { label: "CONTESTAÇÃO PERDIDA", tone: "lost" };
    return { label: "EM CONTESTAÇÃO", tone: "open" };
  }

  function workflowMeta(status) {
    const mapping = {
      not_started: { label: "NÃO INICIADA", tone: "neutral" },
      collecting: { label: "COLETANDO EVIDÊNCIAS", tone: "warning" },
      ready: { label: "PRONTA PARA ENVIO", tone: "ready" },
      submitted: { label: "ENVIO MARCADO", tone: "submitted" },
      closed: { label: "ENCERRADA", tone: "closed" }
    };
    return mapping[status] || mapping.not_started;
  }

  function normalizeChargebacks(rows) {
    return (Array.isArray(rows) ? rows : []).map(function (row) {
      const preparationStatus = toString(row && row.preparation_status);
      return {
        caseId: toString(row && row.case_id),
        tuitionId: toString(row && row.tuition_id),
        chargebackId: toString(row && row.chargeback_id),
        amount: toNumber(row && row.amount),
        currency: toString(row && row.currency) || "BRL",
        reason: toString(row && row.reason),
        coverageEligible: row && typeof row.coverage_eligible === "boolean" ? row.coverage_eligible : null,
        documentationStatus: toString(row && row.documentation_status),
        documentationDeadline: toString(row && row.documentation_deadline),
        operationalStatus: ["open", "won", "lost"].includes(toString(row && row.operational_status))
          ? toString(row.operational_status)
          : "open",
        paymentStatus: toString(row && row.payment_status),
        preparationStatus: ["not_started", "collecting", "ready", "submitted", "closed"].includes(preparationStatus)
          ? preparationStatus
          : "not_started",
        evidenceTotal: toNumber(row && row.evidence_total),
        evidenceIncluded: toNumber(row && row.evidence_included),
        submissionMarkedAt: toString(row && row.submission_marked_at),
        createdAt: toString(row && row.provider_created_at),
        updatedAt: toString(row && row.provider_updated_at)
      };
    }).filter(function (item) { return item.caseId && item.tuitionId && item.chargebackId; });
  }

  function escapeHtml(value) {
    return toString(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatCurrency(value, currency) {
    try {
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: currency || "BRL"
      }).format(toNumber(value));
    } catch (_) {
      return "R$ " + toNumber(value).toFixed(2).replace(".", ",");
    }
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    }).format(date);
  }

  function documentationText(item) {
    const status = item.documentationStatus || "não informado";
    const deadline = item.documentationDeadline ? " · prazo " + formatDate(item.documentationDeadline) : "";
    return status + deadline;
  }

  function workflowText(item) {
    const meta = workflowMeta(item.preparationStatus);
    const evidence = item.evidenceTotal
      ? item.evidenceIncluded + "/" + item.evidenceTotal + " incluídas"
      : "sem evidências cadastradas";
    return '<span class="chargeback-workflow ' + meta.tone + '">' + meta.label + '</span><br><small>' + escapeHtml(evidence) + '</small>';
  }

  function managementButton(item) {
    return '<button class="chargeback-manage-button" type="button" data-chargeback-manage="true" ' +
      'data-chargeback-case-id="' + escapeHtml(item.caseId) + '" data-chargeback-provider-id="' + escapeHtml(item.chargebackId) + '">' +
      'GERENCIAR DOCUMENTAÇÃO</button>';
  }

  function buildMarkup(chargebacks) {
    const rows = normalizeChargebacks(chargebacks);
    if (!rows.length) {
      return '<section class="chargeback-panel" aria-labelledby="chargeback-title">' +
        '<div class="chargeback-heading"><div><span class="chargeback-kicker">CONTESTAÇÕES</span>' +
        '<h2 id="chargeback-title">Chargebacks do Mercado Pago</h2></div>' +
        '<span class="chargeback-summary healthy">Nenhuma contestação no mês</span></div>' +
        '<p class="chargeback-empty">Não há chargebacks vinculados às mensalidades deste mês de referência.</p></section>';
    }

    const openCount = rows.filter(function (item) { return item.operationalStatus === "open"; }).length;
    const body = rows.map(function (item) {
      const meta = statusMeta(item.operationalStatus);
      return '<tr>' +
        '<td><strong>' + escapeHtml(item.chargebackId) + '</strong><br><small>' + escapeHtml(item.reason || "Motivo não informado") + '</small></td>' +
        '<td>' + escapeHtml(formatCurrency(item.amount, item.currency)) + '</td>' +
        '<td><span class="chargeback-status ' + meta.tone + '">' + meta.label + '</span><br><small>Pagamento: ' + escapeHtml(item.paymentStatus || "não informado") + '</small></td>' +
        '<td>' + escapeHtml(documentationText(item)) + '</td>' +
        '<td>' + workflowText(item) + '</td>' +
        '<td>' + managementButton(item) + '</td>' +
        '</tr>';
    }).join("");

    return '<section class="chargeback-panel" aria-labelledby="chargeback-title">' +
      '<div class="chargeback-heading"><div><span class="chargeback-kicker">CONTESTAÇÕES</span>' +
      '<h2 id="chargeback-title">Chargebacks do Mercado Pago</h2></div>' +
      '<span class="chargeback-summary ' + (openCount ? "critical" : "healthy") + '">' +
      (openCount ? openCount + ' em contestação' : 'Sem contestações abertas') + '</span></div>' +
      '<p class="chargeback-description">Casos recebidos diretamente do Mercado Pago. Enquanto a contestação estiver aberta, reembolsos manuais ficam bloqueados.</p>' +
      '<div class="chargeback-table-wrap"><table class="chargeback-table"><thead><tr>' +
      '<th>Caso</th><th>Valor</th><th>Situação</th><th>Mercado Pago</th><th>Preparação</th><th>Ação</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div></section>';
  }

  function installStyles(documentRef) {
    if (!documentRef || documentRef.getElementById(STYLE_ID)) return;
    const style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".chargeback-panel{margin:24px 0;padding:22px;border:1px solid #d9e0ea;border-radius:16px;background:#fff}",
      ".chargeback-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:10px}",
      ".chargeback-kicker{font-size:11px;font-weight:800;letter-spacing:.12em;color:#667085}",
      ".chargeback-heading h2{margin:4px 0 0;font-size:20px;color:#172033}",
      ".chargeback-summary{padding:7px 10px;border-radius:999px;font-size:12px;font-weight:800;white-space:nowrap}",
      ".chargeback-summary.healthy{background:#ecfdf3;color:#027a48}.chargeback-summary.critical{background:#fff1f3;color:#c01048}",
      ".chargeback-description,.chargeback-empty{color:#667085;margin:0 0 16px;font-size:14px}",
      ".chargeback-table-wrap{overflow:auto}.chargeback-table{width:100%;border-collapse:collapse;min-width:980px}",
      ".chargeback-table th,.chargeback-table td{text-align:left;padding:12px 10px;border-top:1px solid #eaecf0;vertical-align:top;font-size:13px}",
      ".chargeback-table th{font-size:11px;letter-spacing:.04em;color:#667085;text-transform:uppercase}",
      ".chargeback-table small{color:#667085}.chargeback-status,.chargeback-workflow{display:inline-block;padding:4px 7px;border-radius:999px;font-size:10px;font-weight:800}",
      ".chargeback-status.open,.chargeback-workflow.warning{background:#fff4e5;color:#b54708}.chargeback-status.won,.chargeback-workflow.ready{background:#ecfdf3;color:#027a48}",
      ".chargeback-status.lost{background:#fff1f3;color:#c01048}.chargeback-workflow.neutral,.chargeback-workflow.closed{background:#f2f4f7;color:#475467}.chargeback-workflow.submitted{background:#eef4ff;color:#3538cd}",
      ".chargeback-manage-button{border:1px solid #344054;background:#fff;color:#344054;border-radius:8px;padding:7px 9px;font-size:10px;font-weight:800;cursor:pointer}",
      ".chargeback-manage-button:hover{background:#f9fafb}button[data-chargeback-locked=true]{cursor:not-allowed;opacity:.72}",
      "@media(max-width:620px){.chargeback-panel{padding:16px}.chargeback-heading{display:block}.chargeback-summary{display:inline-block;margin-top:10px}}"
    ].join("");
    documentRef.head.appendChild(style);
  }

  function renderPanel(documentRef, chargebacks) {
    let container = documentRef.getElementById(PANEL_ID);
    if (!container) {
      container = documentRef.createElement("div");
      container.id = PANEL_ID;
      const anchor = documentRef.getElementById("paymentOperationsDashboard") || documentRef.querySelector(".summary-grid");
      if (!anchor || !anchor.parentNode) return false;
      anchor.parentNode.insertBefore(container, anchor.nextSibling);
    }
    container.innerHTML = buildMarkup(chargebacks);
    return true;
  }

  function restoreLockedButtons(documentRef) {
    documentRef.querySelectorAll('button[data-chargeback-locked="true"]').forEach(function (button) {
      button.disabled = false;
      button.dataset.action = button.dataset.chargebackOriginalAction || button.dataset.action;
      button.textContent = button.dataset.chargebackOriginalLabel || button.textContent;
      delete button.dataset.chargebackLocked;
      delete button.dataset.chargebackOriginalAction;
      delete button.dataset.chargebackOriginalLabel;
    });
  }

  function lockOpenChargebackActions(documentRef, chargebacks) {
    if (!documentRef || typeof documentRef.querySelectorAll !== "function") return 0;
    restoreLockedButtons(documentRef);
    const openTuitionIds = new Set(normalizeChargebacks(chargebacks)
      .filter(function (item) { return item.operationalStatus === "open"; })
      .map(function (item) { return item.tuitionId; }));
    let locked = 0;
    documentRef.querySelectorAll('button[data-tuition-id]').forEach(function (button) {
      const action = toString(button.dataset.action);
      if (!openTuitionIds.has(toString(button.dataset.tuitionId))) return;
      if (action !== "reverse" && action !== "provider-refund") return;
      button.dataset.chargebackOriginalAction = action;
      button.dataset.chargebackOriginalLabel = button.textContent;
      button.dataset.chargebackLocked = "true";
      button.dataset.action = "chargeback-locked";
      button.disabled = true;
      button.textContent = "EM CONTESTAÇÃO";
      button.title = "Ação financeira bloqueada enquanto o chargeback estiver aberto";
      locked += 1;
    });
    return locked;
  }

  async function loadChargebacks(windowRef, documentRef) {
    const referenceMonth = selectedMonth(documentRef);
    if (!referenceMonth) return [];
    const response = await windowRef.Auth.getClient().functions.invoke("list-mercado-pago-chargebacks", {
      body: { reference_month: referenceMonth }
    });
    if (response.error) throw response.error;
    return normalizeChargebacks(response.data && response.data.chargebacks);
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef, documentRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (windowRef.Auth && typeof windowRef.Auth.getClient === "function" && documentRef.getElementById("referenceMonth")) return true;
      await wait(150, windowRef);
    }
    return false;
  }

  function bindRefresh(dependencies, refresh) {
    const documentRef = dependencies.documentRef;
    const windowRef = dependencies.windowRef;
    [documentRef.getElementById("referenceMonth"), documentRef.getElementById("refreshMonthButton")]
      .filter(Boolean)
      .forEach(function (element) {
        if (element.dataset.chargebackOperationsBound) return;
        element.dataset.chargebackOperationsBound = "true";
        element.addEventListener(element.id === "referenceMonth" ? "change" : "click", function () {
          windowRef.setTimeout(function () { refresh().catch(function () {}); }, REFRESH_DELAY_MS);
        });
      });
  }

  function observeTable(dependencies, getChargebacks) {
    const table = dependencies.documentRef.getElementById("tuitionTableBody");
    const Observer = dependencies.windowRef.MutationObserver;
    if (!table || !Observer) return null;
    const observer = new Observer(function () {
      lockOpenChargebackActions(dependencies.documentRef, getChargebacks());
    });
    observer.observe(table, { childList: true, subtree: true });
    return observer;
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;
    if (!(await waitForDependencies(windowRef, documentRef))) return false;
    installStyles(documentRef);

    let chargebacks = [];
    const refresh = async function () {
      chargebacks = await loadChargebacks(windowRef, documentRef);
      renderPanel(documentRef, chargebacks);
      lockOpenChargebackActions(documentRef, chargebacks);
      if (typeof windowRef.CustomEvent === "function") {
        documentRef.dispatchEvent(new windowRef.CustomEvent("payment-chargebacks-refreshed", { detail: { chargebacks: chargebacks } }));
      }
      return chargebacks;
    };

    bindRefresh({ windowRef: windowRef, documentRef: documentRef }, refresh);
    observeTable({ windowRef: windowRef, documentRef: documentRef }, function () { return chargebacks; });
    try {
      await refresh();
    } catch (error) {
      console.warn("Não foi possível carregar as contestações do Mercado Pago.", error);
    }
    return true;
  }

  return Object.freeze({
    statusMeta: statusMeta,
    workflowMeta: workflowMeta,
    normalizeChargebacks: normalizeChargebacks,
    buildMarkup: buildMarkup,
    lockOpenChargebackActions: lockOpenChargebackActions,
    initialize: initialize
  });
});
