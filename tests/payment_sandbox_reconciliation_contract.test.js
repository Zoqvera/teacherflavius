const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const functionSource = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "functions", "reconcile-mercado-pago-sandbox", "index.ts"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260911180659_add_mercado_pago_sandbox_reconciliation_recovery.sql"
  ),
  "utf8"
);

test("sandbox reconciliation uses only the test Mercado Pago credential", () => {
  assert.match(functionSource, /MERCADO_PAGO_TEST_ACCESS_TOKEN/);
  assert.doesNotMatch(functionSource, /Deno\.env\.get\("MERCADO_PAGO_ACCESS_TOKEN"\)/);
  assert.match(functionSource, /api\.mercadopago\.com\/v1\/payments/);
});

test("sandbox reconciliation authenticates service-to-service dispatch with the existing signed reconciliation control", () => {
  assert.match(functionSource, /x-reconciliation-timestamp/);
  assert.match(functionSource, /x-reconciliation-signature/);
  assert.match(functionSource, /validate_mercado_pago_reconciliation_signature/);
  assert.match(functionSource, /AUTH_TIMESTAMP_TOLERANCE_MS/);
  assert.match(migrationSource, /mercado_pago_reconciliation_cron_secret/);
  assert.match(migrationSource, /extensions\.hmac\(request_timestamp, reconciliation_secret, 'sha256'\)/);
});

test("missed-webhook recovery discovers provider payment by external reference", () => {
  assert.match(functionSource, /external_reference: externalReference/);
  assert.match(functionSource, /discoverSandboxPayment/);
  assert.match(functionSource, /provider_payment_id/);
  assert.match(functionSource, /reconciliation_status: "recovered"/);
  assert.match(functionSource, /recovered_at: now/);
  assert.match(functionSource, /payment\.live_mode === false/);
  assert.match(functionSource, /sandbox-card-/);
});

test("search results are discovery only and each payment id is re-queried before recovery", () => {
  assert.match(functionSource, /PAYMENT_SEARCH_ENDPOINT/);
  assert.match(functionSource, /uniqueSearchPaymentIds/);
  assert.match(functionSource, /fetchProviderPayment/);
  assert.match(functionSource, /PAYMENT_ENDPOINT.*encodeURIComponent\(paymentId\)/s);
  assert.match(functionSource, /validatePaymentDetails/);
  assert.match(functionSource, /payment\.live_mode === true/);
  assert.match(functionSource, /payment\.live_mode !== false/);
  assert.match(functionSource, /live_payment_rejected/);
  assert.match(functionSource, /multiple_matches/);
});

test("sandbox reconciliation is isolated from webhook evidence and production financial state", () => {
  assert.match(functionSource, /mercado_pago_sandbox_reconciliation_candidates/);
  assert.doesNotMatch(functionSource, /mercado_pago_sandbox_webhook_events/);
  assert.doesNotMatch(functionSource, /monthly_tuition/);
  assert.doesNotMatch(functionSource, /tuition_payment_attempts/);
  assert.doesNotMatch(functionSource, /process_mercado_pago_payment/);
  assert.doesNotMatch(functionSource, /MERCADO_PAGO_WEBHOOK_SECRET/);
});

test("sandbox reconciliation table is restricted and explicitly models missing webhook recovery", () => {
  assert.match(migrationSource, /scenario text not null default 'missed_webhook'/);
  assert.match(migrationSource, /provider_payment_id text/);
  assert.match(migrationSource, /reconciliation_status text not null default 'pending'/);
  assert.match(
    migrationSource,
    /alter table public\.mercado_pago_sandbox_reconciliation_candidates enable row level security/
  );
  assert.match(
    migrationSource,
    /revoke all on table public\.mercado_pago_sandbox_reconciliation_candidates\s+from public, anon, authenticated/
  );
  assert.match(
    migrationSource,
    /grant select, insert, update, delete on table public\.mercado_pago_sandbox_reconciliation_candidates\s+to service_role/
  );
});

test("sandbox reconciliation dispatcher is manual and does not create a recurring cron", () => {
  assert.match(migrationSource, /private\.dispatch_mercado_pago_sandbox_reconciliation/);
  assert.match(migrationSource, /reconcile-mercado-pago-sandbox/);
  assert.match(migrationSource, /net\.http_post/);
  assert.doesNotMatch(migrationSource, /cron\.schedule/);
});
