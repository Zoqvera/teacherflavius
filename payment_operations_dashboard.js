(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) {
    root.PaymentOperationsDashboard = api;
    api.initialize({ windowRef: root, documentRef: root.document });
  }
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  const DASHBOARD_ID = "paymentOperationsDashboard";
  const STYLE_ID = "paymentOperationsDashboardStyles";
  const HEALTHY = Object.freeze({ label: "Operação saudável", tone: "healthy" });
  const WARNING = Object.freeze({ label: "Atenção operacional", tone: "warning" });
  const CRITICAL = Object.freeze({ label: "Intervenção necessária", tone: "critical" });

  function toNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function readMetric(metric) {
    const source = metric && typeof metric === "object" ? metric : {};
    return {
      count: toNumber(source.count),
      amount: toNumber(source.amount)
    };
  }

  function readMethods(methods) {
    const source = methods && typeof methods === "object" ? methods : {};
    return {
      pix: readMetric(source.pix),
      card: readMetric(source.card)
    };
  }

  function readFinancialHealth(financialHealth) {
    const source = financialHealth && typeof financialHealth === "object" ? financialHealth : {};
    const issueCodes = Array.isArray(source.issue_codes)
      ? source.issue_codes.filter(function (item) { return typeof item === "string"; })
      : [];
    return {
      status: String(source.status || "unknown").toLowerCase(),
      completedAt: String(source.completed_at || ""),
      stale: source.stale !== false,
      warningCount: toNumber(source.warning_count),
      criticalCount: toNumber(source.critical_count),
      issueCount: toNumber(source.issue_count),
      issueCodes: issueCodes
    };
  }

  function resolveHealth(state) {
    if (
      state.financialHealthStatus === "critical" ||
      state.criticalOpenAlerts > 0 ||
      state.divergences > 0
    ) return CRITICAL;

    if (
      state.financialHealthStale ||
      state.financialHealthStatus === "degraded" ||
      state.financialHealthStatus === "unknown" ||
      state.reconciliationStalled ||
      state.failedAlerts > 0 ||
      state.reconciliationFailures > 0 ||
      state.gatewayFailures24h > 0 ||
      state.invalidWebhooks24h > 0
    ) {
      return WARNING;
    }
    return HEALTHY;
  }

  function normalizeDashboard(raw) {
    const source = raw && typeof raw === "object" ? raw : {};
    const divergences = source.divergences && typeof source.divergences === "object"
      ? source.divergences
      : {};
    const alerts = source.alerts && typeof source.alerts === "object" ? source.alerts : {};
    const methods = readMethods(source.methods);
    const financialHealth = readFinancialHealth(source.financial_health);
    const state = {
      referenceMonth: String(source.reference_month || ""),
      generatedAt: String(source.generated_at || ""),
      approved: readMetric(source.approved),
      pending: readMetric(source.pending),
      rejected: readMetric(source.rejected),
      pix: methods.pix,
      card: methods.card,
      gatewayFailures24h: toNumber(source.gateway_failures_24h),
      invalidWebhooks24h: toNumber(source.invalid_webhooks_24h),
      lastReconciliationAt: String(source.last_reconciliation_at || ""),
      reconciliationStalled: source.reconciliation_stalled === true,
      reconciliationFailures: toNumber(source.reconciliation_failures),
      approvedWithoutApplication: toNumber(divergences.approved_without_application),
      reversalPending: toNumber(divergences.reversal_pending),
      duplicatePayments: toNumber(source.duplicate_payments),
      reversals: toNumber(source.reversals),
      pendingAlerts: toNumber(alerts.pending),
      failedAlerts: toNumber(alerts.failed),
      criticalOpenAlerts: toNumber(alerts.critical_open),
      financialHealthStatus: financialHealth.status,
      financialHealthCompletedAt: financialHealth.completedAt,
      financialHealthStale: financialHealth.stale,
      financialHealthWarningCount: financialHealth.warningCount,
      financialHealthCriticalCount: financialHealth.criticalCount,
      financialHealthIssueCount: financialHealth.issueCount,
      financialHealthIssueCodes: financialHealth.issueCodes
    };
    state.divergences = state.approvedWithoutApplication + state.reversalPending;
    state.health = resolveHealth(state);
    return state;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(toNumber(value));
  }

  function formatDateTime(value) {
    if (!value) return "Ainda não registrada";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Data indisponível";
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo"
    }).format(date);
  }

  function financialHealthLabel(state) {
    if (state.financialHealthStale) return "ATRASADO";
    if (state.financialHealthStatus === "healthy") return "SAUDÁVEL";
    if (state.financialHealthStatus === "degraded") return "ATENÇÃO";
    if (state.financialHealthStatus === "critical") return "CRÍTICO";
    return "SEM DADOS";
  }

  function financialHealthTone(state) {
    if (state.financialHealthStatus === "critical") return "critical";
    if (state.financialHealthStale || state.financialHealthStatus !== "healthy") return "warning";
    return "healthy";
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function metricCard(label, value, detail, tone) {
    return '<article class="payment-ops-card ' + escapeHtml(tone || "neutral") + '">' +
      '<span class="payment-ops-card__label">' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(value) + '</strong>' +
      '<small>' + escapeHtml(detail) + '</small>' +
    '</article>';
  }

  function buildMarkup(state) {
    const health = state.health || HEALTHY;
    const reconciliationStatus = state.reconciliationStalled ? "ATRASADA" : "EM DIA";
    const financialStatus = financialHealthLabel(state);
    const cards = [
      metricCard("Health check", financialStatus, state.financialHealthIssueCount + " problema(s)", financialHealthTone(state)),
      metricCard("Aprovados", state.approved.count, formatCurrency(state.approved.amount), "healthy"),
      metricCard("Pendentes", state.pending.count, formatCurrency(state.pending.amount), state.pending.count ? "warning" : "neutral"),
      metricCard("Rejeitados", state.rejected.count, formatCurrency(state.rejected.amount), state.rejected.count ? "warning" : "neutral"),
      metricCard("PIX", state.pix.count, formatCurrency(state.pix.amount), "neutral"),
      metricCard("Cartão", state.card.count, formatCurrency(state.card.amount), "neutral"),
      metricCard("Falhas do gateway · 24h", state.gatewayFailures24h, "Mercado Pago", state.gatewayFailures24h ? "warning" : "healthy"),
      metricCard("Divergências", state.divergences, "gateway ↔ banco", state.divergences ? "critical" : "healthy"),
      metricCard("Duplicidades", state.duplicatePayments, "no mês selecionado", state.duplicatePayments ? "critical" : "healthy"),
      metricCard("Estornos", state.reversals, "no mês selecionado", state.reversals ? "warning" : "neutral"),
      metricCard("Alertas abertos", state.pendingAlerts + state.failedAlerts, state.criticalOpenAlerts + " crítico(s)", state.criticalOpenAlerts ? "critical" : (state.failedAlerts ? "warning" : "healthy"))
    ].join("");

    return '<div class="payment-ops-header">' +
      '<div><h2>Saúde técnica dos pagamentos</h2>' +
      '<p>Mercado Pago, reconciliação, invariantes financeiras e alertas operacionais.</p></div>' +
      '<span class="payment-ops-health ' + escapeHtml(health.tone) + '">' + escapeHtml(health.label) + '</span>' +
    '</div>' +
    '<div class="payment-ops-grid">' + cards + '</div>' +
    '<div class="payment-ops-footnotes">' +
      '<span><strong>Último health check:</strong> ' + escapeHtml(formatDateTime(state.financialHealthCompletedAt)) + '</span>' +
      '<span><strong>Invariantes críticas:</strong> ' + escapeHtml(state.financialHealthCriticalCount) + '</span>' +
      '<span><strong>Invariantes em atenção:</strong> ' + escapeHtml(state.financialHealthWarningCount) + '</span>' +
      '<span><strong>Última reconciliação:</strong> ' + escapeHtml(formatDateTime(state.lastReconciliationAt)) + '</span>' +
      '<span><strong>Reconciliação automática:</strong> ' + escapeHtml(reconciliationStatus) + '</span>' +
      '<span><strong>Falhas de reconciliação:</strong> ' + escapeHtml(state.reconciliationFailures) + '</span>' +
      '<span><strong>Webhooks inválidos · 24h:</strong> ' + escapeHtml(state.invalidWebhooks24h) + '</span>' +
      '<span><strong>Aprovados sem baixa:</strong> ' + escapeHtml(state.approvedWithoutApplication) + '</span>' +
      '<span><strong>Reversões pendentes:</strong> ' + escapeHtml(state.reversalPending) + '</span>' +
    '</div>';
  }

  function injectStyles(documentRef) {
    if (documentRef.getElementById(STYLE_ID)) return;
    const style = documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".payment-operations-panel{margin-top:22px}",
      ".payment-ops-header{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:18px}",
      ".payment-ops-header h2{color:#f1f5f9;font-size:22px;margin:0 0 6px}",
      ".payment-ops-header p{color:#94a3b8;font-size:13px;line-height:1.5;margin:0}",
      ".payment-ops-health{border:1px solid;border-radius:999px;flex-shrink:0;font-size:11px;font-weight:700;padding:8px 11px}",
      ".payment-ops-health.healthy{background:rgba(16,185,129,.12);border-color:rgba(52,211,153,.38);color:#a7f3d0}",
      ".payment-ops-health.warning{background:rgba(245,158,11,.12);border-color:rgba(251,191,36,.4);color:#fde68a}",
      ".payment-ops-health.critical{background:rgba(239,68,68,.12);border-color:rgba(248,113,113,.4);color:#fca5a5}",
      ".payment-ops-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}",
      ".payment-ops-card{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09);border-radius:15px;padding:15px;min-width:0}",
      ".payment-ops-card.healthy{border-color:rgba(52,211,153,.26)}",
      ".payment-ops-card.warning{border-color:rgba(251,191,36,.34)}",
      ".payment-ops-card.critical{border-color:rgba(248,113,113,.4)}",
      ".payment-ops-card__label{color:#94a3b8;display:block;font-size:10px;font-weight:700;letter-spacing:.06em;margin-bottom:9px;text-transform:uppercase}",
      ".payment-ops-card strong{color:#f8fafc;display:block;font-size:25px;line-height:1;margin-bottom:7px}",
      ".payment-ops-card small{color:#64748b;display:block;font-size:11px;line-height:1.35}",
      ".payment-ops-footnotes{border-top:1px solid rgba(255,255,255,.08);color:#94a3b8;display:flex;flex-wrap:wrap;gap:10px 22px;font-size:11px;margin-top:18px;padding-top:15px}",
      ".payment-ops-footnotes strong{color:#cbd5e1}",
      ".payment-ops-loading,.payment-ops-error{border:1px solid rgba(255,255,255,.1);border-radius:12px;color:#94a3b8;padding:16px}",
      ".payment-ops-error{background:rgba(239,68,68,.08);border-color:rgba(248,113,113,.28);color:#fca5a5}",
      "@media(max-width:960px){.payment-ops-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
      "@media(max-width:620px){.payment-ops-header{flex-direction:column}.payment-ops-grid{grid-template-columns:1fr}.payment-ops-health{align-self:flex-start}}"
    ].join("");
    documentRef.head.appendChild(style);
  }

  function mount(documentRef) {
    let section = documentRef.getElementById(DASHBOARD_ID);
    if (section) return section;

    const summaryGrid = documentRef.querySelector(".summary-grid");
    if (!summaryGrid || !summaryGrid.parentNode) return null;

    section = documentRef.createElement("section");
    section.id = DASHBOARD_ID;
    section.className = "finance-panel payment-operations-panel";
    section.setAttribute("aria-live", "polite");
    section.innerHTML = '<div class="payment-ops-loading">Carregando indicadores técnicos de pagamento...</div>';
    summaryGrid.parentNode.insertBefore(section, summaryGrid.nextSibling);
    return section;
  }

  function selectedMonth(documentRef) {
    const field = documentRef.getElementById("referenceMonth");
    const value = field && /^\d{4}-\d{2}$/.test(field.value) ? field.value : "";
    return value ? value + "-01" : null;
  }

  function wait(milliseconds, windowRef) {
    return new Promise(function (resolve) { windowRef.setTimeout(resolve, milliseconds); });
  }

  async function waitForDependencies(windowRef, documentRef) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if (
        windowRef.Auth &&
        typeof windowRef.Auth.getClient === "function" &&
        documentRef.getElementById("referenceMonth")
      ) return true;
      await wait(150, windowRef);
    }
    return false;
  }

  async function refresh(dependencies) {
    const windowRef = dependencies.windowRef;
    const documentRef = dependencies.documentRef;
    const section = mount(documentRef);
    if (!section || !windowRef.Auth) return null;

    section.innerHTML = '<div class="payment-ops-loading">Atualizando saúde técnica dos pagamentos...</div>';
    const response = await windowRef.Auth.getClient().rpc("get_teacher_payment_operations_dashboard", {
      target_reference_month: selectedMonth(documentRef)
    });

    if (response.error) {
      section.innerHTML = '<div class="payment-ops-error">Não foi possível carregar o dashboard técnico: ' +
        escapeHtml(response.error.message || "erro desconhecido") + '</div>';
      throw response.error;
    }

    const state = normalizeDashboard(response.data);
    section.innerHTML = buildMarkup(state);
    return state;
  }

  function bindRefreshEvents(dependencies) {
    const documentRef = dependencies.documentRef;
    const windowRef = dependencies.windowRef;
    const monthField = documentRef.getElementById("referenceMonth");
    const refreshButton = documentRef.getElementById("refreshMonthButton");

    if (monthField && !monthField.dataset.paymentDashboardBound) {
      monthField.dataset.paymentDashboardBound = "true";
      monthField.addEventListener("change", function () {
        windowRef.setTimeout(function () { refresh(dependencies).catch(function () {}); }, 150);
      });
    }

    if (refreshButton && !refreshButton.dataset.paymentDashboardBound) {
      refreshButton.dataset.paymentDashboardBound = "true";
      refreshButton.addEventListener("click", function () {
        windowRef.setTimeout(function () { refresh(dependencies).catch(function () {}); }, 900);
      });
    }
  }

  async function initialize(dependencies) {
    const windowRef = dependencies && dependencies.windowRef;
    const documentRef = dependencies && dependencies.documentRef;
    if (!windowRef || !documentRef) return false;

    injectStyles(documentRef);
    const ready = await waitForDependencies(windowRef, documentRef);
    if (!ready) return false;

    bindRefreshEvents({ windowRef: windowRef, documentRef: documentRef });
    try {
      await refresh({ windowRef: windowRef, documentRef: documentRef });
    } catch (error) {
      console.warn("Não foi possível inicializar o dashboard técnico de pagamentos.", error);
    }
    return true;
  }

  return Object.freeze({
    buildMarkup: buildMarkup,
    formatCurrency: formatCurrency,
    normalizeDashboard: normalizeDashboard,
    resolveHealth: resolveHealth,
    initialize: initialize,
    refresh: refresh
  });
});
