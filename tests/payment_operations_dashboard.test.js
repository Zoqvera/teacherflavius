const test = require("node:test");
const assert = require("node:assert/strict");
const Dashboard = require("../payment_operations_dashboard.js");

test("normalizes payment operation metrics", () => {
  const state = Dashboard.normalizeDashboard({
    approved: { count: 3, amount: 299.7 },
    pending: { count: 1, amount: 99.9 },
    rejected: { count: 2, amount: 199.8 },
    methods: {
      pix: { count: 2, amount: 199.8 },
      card: { count: 1, amount: 99.9 }
    },
    gateway_failures_24h: 0,
    invalid_webhooks_24h: 0,
    reconciliation_stalled: false,
    reconciliation_failures: 0,
    divergences: {
      approved_without_application: 0,
      reversal_pending: 0
    },
    duplicate_payments: 0,
    reversals: 0,
    alerts: { pending: 0, failed: 0, critical_open: 0 }
  });

  assert.equal(state.approved.count, 3);
  assert.equal(state.approved.amount, 299.7);
  assert.equal(state.pix.count, 2);
  assert.equal(state.card.count, 1);
  assert.equal(state.divergences, 0);
  assert.equal(state.reconciliationStalled, false);
  assert.equal(state.health.tone, "healthy");
});

test("marks unresolved financial divergences as critical", () => {
  const state = Dashboard.normalizeDashboard({
    divergences: {
      approved_without_application: 1,
      reversal_pending: 1
    },
    alerts: { critical_open: 0 }
  });

  assert.equal(state.divergences, 2);
  assert.equal(state.health.tone, "critical");
  assert.equal(state.health.label, "Intervenção necessária");
});

test("marks gateway and reconciliation failures as warning", () => {
  const state = Dashboard.normalizeDashboard({
    gateway_failures_24h: 2,
    reconciliation_failures: 1,
    reconciliation_stalled: false,
    divergences: {},
    alerts: {}
  });

  assert.equal(state.health.tone, "warning");
});

test("marks stalled automatic reconciliation as warning", () => {
  const state = Dashboard.normalizeDashboard({
    reconciliation_stalled: true,
    divergences: {},
    alerts: {}
  });

  assert.equal(state.reconciliationStalled, true);
  assert.equal(state.health.tone, "warning");
  assert.match(Dashboard.buildMarkup(state), /Reconciliação automática:<\/strong> ATRASADA/);
});

test("renders all required technical indicators", () => {
  const state = Dashboard.normalizeDashboard({
    approved: { count: 3, amount: 299.7 },
    pending: { count: 0, amount: 0 },
    rejected: { count: 0, amount: 0 },
    methods: { pix: { count: 3, amount: 299.7 } },
    gateway_failures_24h: 0,
    invalid_webhooks_24h: 0,
    reconciliation_stalled: false,
    divergences: {},
    duplicate_payments: 0,
    reversals: 0,
    alerts: {}
  });
  const markup = Dashboard.buildMarkup(state);

  [
    "Aprovados",
    "Pendentes",
    "Rejeitados",
    "PIX",
    "Cartão",
    "Falhas do gateway",
    "Divergências",
    "Duplicidades",
    "Estornos",
    "Alertas abertos",
    "Última reconciliação",
    "Reconciliação automática"
  ].forEach((label) => assert.match(markup, new RegExp(label)));
});
