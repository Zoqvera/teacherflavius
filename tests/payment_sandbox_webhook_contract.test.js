const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const functionSource = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "functions", "mercado-pago-sandbox-webhook", "index.ts"),
  "utf8"
);
const migrationSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260911162633_add_mercado_pago_sandbox_webhook_log.sql"
  ),
  "utf8"
);

test("sandbox webhook uses isolated test credentials and HMAC validation", () => {
  assert.match(functionSource, /MERCADO_PAGO_TEST_ACCESS_TOKEN/);
  assert.match(functionSource, /MERCADO_PAGO_TEST_WEBHOOK_SECRET/);
  assert.match(functionSource, /x-signature/);
  assert.match(functionSource, /x-request-id/);
  assert.match(functionSource, /validateSignature/);
  assert.match(functionSource, /HMAC/);
});

test("sandbox webhook refuses production-mode payments", () => {
  assert.match(functionSource, /payload\.live_mode !== false/);
  assert.match(functionSource, /payment\.live_mode !== false/);
  assert.match(functionSource, /Only sandbox events are accepted/);
  assert.match(functionSource, /sandbox_live_payment_rejected/);
  assert.match(functionSource, /sandbox-card-/);
});

test("sandbox webhook re-queries Mercado Pago before persisting evidence", () => {
  assert.match(functionSource, /https:\/\/api\.mercadopago\.com\/v1\/payments/);
  assert.match(functionSource, /fetchSandboxPayment/);
  assert.match(functionSource, /validateSandboxPayment/);
  assert.match(functionSource, /provider_status/);
  assert.match(functionSource, /transaction_amount/);
});

test("sandbox webhook remains separate from production financial state", () => {
  assert.match(functionSource, /mercado_pago_sandbox_webhook_events/);
  assert.doesNotMatch(functionSource, /monthly_tuition/);
  assert.doesNotMatch(functionSource, /payment_attempts/);
  assert.doesNotMatch(functionSource, /process_mercado_pago_payment/);
  assert.doesNotMatch(functionSource, /synchronizeMercadoPagoPayment/);
});

test("sandbox webhook evidence table is service-role only with RLS", () => {
  assert.match(migrationSource, /alter table public\.mercado_pago_sandbox_webhook_events enable row level security/);
  assert.match(
    migrationSource,
    /revoke all on table public\.mercado_pago_sandbox_webhook_events from public, anon, authenticated/
  );
  assert.match(
    migrationSource,
    /grant select, insert, update on table public\.mercado_pago_sandbox_webhook_events to service_role/
  );
  assert.match(migrationSource, /check \(live_mode = false\)/);
  assert.match(migrationSource, /check \(signature_valid = true\)/);
});
