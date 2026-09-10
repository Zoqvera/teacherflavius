const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20260910012145_add_automated_payment_financial_health_check.sql"),
  "utf8"
);
const notifier = fs.readFileSync(
  path.join(ROOT, "supabase/functions/notify-payment-alert/index.ts"),
  "utf8"
);
const dashboard = require(path.join(ROOT, "payment_operations_dashboard.js"));

function dashboardFixture(financialHealth) {
  return {
    approved: { count: 3, amount: 299.7 },
    pending: { count: 0, amount: 0 },
    rejected: { count: 0, amount: 0 },
    methods: { pix: { count: 3, amount: 299.7 } },
    gateway_failures_24h: 0,
    invalid_webhooks_24h: 0,
    reconciliation_stalled: false,
    reconciliation_failures: 0,
    divergences: { approved_without_application: 0, reversal_pending: 0 },
    duplicate_payments: 0,
    reversals: 0,
    alerts: { pending: 0, failed: 0, critical_open: 0 },
    financial_health: financialHealth
  };
}

test("financial health history stays private and bounded", () => {
  assert.match(migration, /create table private\.payment_financial_health_runs/i);
  assert.match(migration, /status in \('healthy','degraded','critical'\)/i);
  assert.match(migration, /revoke all on table private\.payment_financial_health_runs from public, anon, authenticated, service_role/i);
  assert.match(migration, /completed_at < now\(\) - interval '90 days'/i);
});

test("financial health check covers critical payment invariants", () => {
  for (const invariant of [
    "approved_without_application",
    "reversal_pending",
    "multiple_approved_per_tuition",
    "applied_tuition_mismatch",
    "rejected_but_applied",
    "refund_inconsistencies",
    "chargeback_inconsistencies",
    "duplicate_provider_payment_ids",
    "duplicate_idempotency_keys",
    "stale_webhook_processing",
    "overdue_chargeback_documentation"
  ]) {
    assert.match(migration, new RegExp(`'${invariant}'`));
  }
  assert.match(migration, /if critical_count_value > 0 then\s+status_value := 'critical'/i);
  assert.match(migration, /elsif warning_count_value > 0 then\s+status_value := 'degraded'/i);
});

test("health check monitors cron dependencies and is cross-monitored", () => {
  assert.match(migration, /payment-financial-health-check/);
  assert.match(migration, /3,8,13,18,23,28,33,38,43,48,53,58 \* \* \* \*/);
  assert.match(migration, /select private\.run_payment_financial_health_check\(true\)/i);
  assert.match(migration, /financial_health_check_stalled/);
  assert.match(migration, /last_health_check_at < now\(\) - interval '15 minutes'/i);
});

test("financial health alerts are transition-based rather than periodic spam", () => {
  assert.match(migration, /transition_detected := status_value <> 'healthy'/i);
  assert.match(migration, /previous_issue_codes is distinct from issue_codes_value/i);
  assert.match(migration, /if target_notify and transition_detected then/i);
  assert.match(migration, /'financial_health_check:' \|\| run_id_value::text/i);
  assert.match(migration, /select private\.run_payment_financial_health_check\(false\)/i);
});

test("dashboard health state reflects persistent financial health", () => {
  const healthy = dashboard.normalizeDashboard(dashboardFixture({
    status: "healthy",
    completed_at: "2026-09-10T01:21:45.452Z",
    stale: false,
    warning_count: 0,
    critical_count: 0,
    issue_count: 0,
    issue_codes: []
  }));
  assert.equal(healthy.health.tone, "healthy");
  assert.equal(healthy.financialHealthStatus, "healthy");
  assert.match(dashboard.buildMarkup(healthy), /Health check/);
  assert.match(dashboard.buildMarkup(healthy), /SAUDÁVEL/);

  const degraded = dashboard.normalizeDashboard(dashboardFixture({
    status: "degraded",
    stale: false,
    warning_count: 1,
    critical_count: 0,
    issue_count: 1,
    issue_codes: ["gateway_failures_24h"]
  }));
  assert.equal(degraded.health.tone, "warning");

  const critical = dashboard.normalizeDashboard(dashboardFixture({
    status: "critical",
    stale: false,
    warning_count: 0,
    critical_count: 1,
    issue_count: 1,
    issue_codes: ["approved_without_application"]
  }));
  assert.equal(critical.health.tone, "critical");

  const stale = dashboard.normalizeDashboard(dashboardFixture({
    status: "healthy",
    stale: true,
    warning_count: 0,
    critical_count: 0,
    issue_count: 0,
    issue_codes: []
  }));
  assert.equal(stale.health.tone, "warning");
  assert.match(dashboard.buildMarkup(stale), /ATRASADO/);
});

test("financial health alert email has a dedicated safe summary", () => {
  assert.match(notifier, /financial_health_check: "Alerta: health check financeiro detectou inconsistências"/);
  assert.match(notifier, /case "financial_health_check":/);
  assert.match(notifier, /cleanDetailList\(details\.issue_codes\)/);
  assert.match(notifier, /Por privacidade, este e-mail não inclui dados cadastrais do aluno/);
});
