const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read("supabase/migrations/20260909211458_monitor_mercado_pago_reconciliation_heartbeat.sql");
const escalationMigration = read("supabase/migrations/20260911190219_escalate_repeated_mercado_pago_reconciliation_failures.sql");
const reconciler = read("supabase/functions/reconcile-mercado-pago-automated/index.ts");
const notifier = read("supabase/functions/notify-payment-alert/index.ts");
const dashboard = read("payment_operations_dashboard.js");

test("heartbeat migration stores bounded reconciliation run history", () => {
  assert.match(migration, /create table public\.payment_reconciliation_runs/);
  assert.match(migration, /status in \('running','succeeded','failed'\)/);
  assert.match(migration, /now\(\) - interval '90 days'/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.payment_reconciliation_runs from public, anon, authenticated/);
});

test("health scan detects a stalled reconciliation after fifteen minutes", () => {
  assert.match(migration, /'reconciliation_stalled'/);
  assert.match(migration, /last_success_at < now\(\) - interval '15 minutes'/);
  assert.match(migration, /'minutes_since_success'/);
  assert.match(migration, /'reconciliation_stalled:' \|\| coalesce/);
});

test("automatic reconciler records run start and terminal heartbeat without controlling payment logic", () => {
  assert.match(reconciler, /begin_mercado_pago_reconciliation_run/);
  assert.match(reconciler, /finish_mercado_pago_reconciliation_run/);
  assert.match(reconciler, /"failed",\s*\{ stage: "candidate_load" \}/);
  assert.match(reconciler, /"succeeded", responseSummary/);
  assert.match(reconciler, /process_mercado_pago_payment/);
});

test("stalled reconciliation alert has a dedicated notification subject", () => {
  assert.match(notifier, /reconciliation_stalled: "Alerta: reconciliação automática sem execução recente"/);
  assert.match(notifier, /Minutos sem execução bem-sucedida/);
});

test("payment dashboard exposes stalled reconciliation as operational warning", () => {
  assert.match(dashboard, /reconciliationStalled: source\.reconciliation_stalled === true/);
  assert.match(dashboard, /state\.reconciliationStalled/);
  assert.match(dashboard, /Reconciliação automática/);
  assert.match(dashboard, /ATRASADA/);
});

test("repeated reconciliation failures escalate at the third consecutive failure", () => {
  assert.match(escalationMigration, /classify_mercado_pago_reconciliation_failure_alert/);
  assert.match(escalationMigration, /previous_failure_count, 0\) = 0 then 'warning'/);
  assert.match(escalationMigration, /previous_failure_count, 0\) < 3/);
  assert.match(escalationMigration, /current_failure_count, 0\) >= 3 then 'critical'/);
  assert.match(escalationMigration, /'escalation_threshold', 3/);
});

test("critical reconciliation escalation keeps retry enabled and uses a separate dedupe key", () => {
  assert.match(escalationMigration, /'reconciliation_failure_escalated:' \|\| new\.id::text/);
  assert.match(escalationMigration, /'reconciliation_failure',\s*'critical'/s);
  assert.match(escalationMigration, /'retry_continues', true/);
});

test("reconciliation escalation preserves gateway failure capture", () => {
  assert.match(escalationMigration, /provider_http_\(429\|5\[0-9\]\{2\}\)_/);
  assert.match(escalationMigration, /provider_http_403_pa_unauthorized_result_from_policies/);
  assert.match(escalationMigration, /'gateway_failure'/);
});
