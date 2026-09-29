const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20260929024500_add_mercado_pago_subscription_sandbox.sql",
);
const webhook = read(
  "supabase/functions/mercado-pago-subscription-sandbox-webhook/index.ts",
);
const probe = read("scripts/mercado_pago_subscription_sandbox_probe.js");
const workflow = read(".github/workflows/payment-contracts.yml");

test("subscription sandbox evidence is isolated and service-role only", () => {
  assert.match(
    migration,
    /create table if not exists public\.mercado_pago_subscription_sandbox_events/i,
  );
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all privileges on table public\.mercado_pago_subscription_sandbox_events\s+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete[\s\S]*to service_role/i,
  );
  assert.match(migration, /live_mode = false/i);
  assert.match(migration, /signature_valid = true/i);
});

test("subscription sandbox webhook never mutates production financial state", () => {
  assert.match(webhook, /MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN/);
  assert.match(webhook, /MERCADO_PAGO_SUBSCRIPTION_SANDBOX_ACCESS_TOKEN/);
  assert.match(webhook, /MERCADO_PAGO_SUBSCRIPTION_SANDBOX_WEBHOOK_SECRET/);
  assert.match(webhook, /MERCADO_PAGO_TEST_ACCESS_TOKEN/);
  assert.match(webhook, /MERCADO_PAGO_TEST_WEBHOOK_SECRET/);
  assert.match(webhook, /mercado_pago_subscription_sandbox_events/);
  assert.match(webhook, /subscription_preapproval/);
  assert.match(webhook, /subscription_authorized_payment/);
  assert.match(webhook, /api\.mercadopago\.com\/preapproval/);
  assert.match(webhook, /api\.mercadopago\.com\/authorized_payments/);
  assert.match(webhook, /api\.mercadopago\.com\/v1\/payments/);
  assert.match(webhook, /sandbox-subscription-/);
  assert.match(webhook, /live_mode !== false/);
  assert.doesNotMatch(webhook, /MERCADO_PAGO_ACCESS_TOKEN/);
  assert.doesNotMatch(webhook, /monthly_tuition/);
  assert.doesNotMatch(webhook, /tuition_payment_attempts/);
  assert.doesNotMatch(webhook, /student_subscriptions/);
  assert.doesNotMatch(webhook, /subscription_authorized_payments/);
  assert.doesNotMatch(webhook, /process_mercado_pago_subscription_invoice/);
});

test("sandbox webhook validates provider state after HMAC validation", () => {
  const signatureIndex = webhook.indexOf("validateSignatureCandidates(");
  const providerIndex = webhook.indexOf("evidenceFromSubscription(accessToken");
  assert.ok(signatureIndex >= 0);
  assert.ok(providerIndex > signatureIndex);
  assert.match(webhook, /deduplication_key/);
  assert.match(webhook, /delivery_count/);
});

test("subscription probe creates only a sandbox subscription and always cancels it", () => {
  assert.match(probe, /MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN/);
  assert.match(probe, /MERCADO_PAGO_SUBSCRIPTION_STAGE_PUBLIC_KEY/);
  assert.match(probe, /test_payer@testuser\.com/);
  assert.doesNotMatch(probe, /MERCADO_PAGO_SUBSCRIPTION_SANDBOX_ACCESS_TOKEN/);
  assert.doesNotMatch(probe, /MERCADO_PAGO_SUBSCRIPTION_SANDBOX_PUBLIC_KEY/);
  assert.doesNotMatch(probe, /MERCADO_PAGO_SUBSCRIPTION_SANDBOX_PAYER_EMAIL/);
  assert.match(probe, /MercadoPagoProbe\.createCardToken/);
  assert.match(probe, /holderName: "APRO"/);
  assert.match(probe, /sandbox-subscription-/);
  assert.match(probe, /url: PREAPPROVAL_ENDPOINT/);
  assert.match(probe, /"X-scope": "stage"/);
  assert.match(probe, /status: "authorized"/);
  assert.match(probe, /RETRYABLE_HTTP_STATUSES/);
  assert.match(probe, /RETRY_DELAYS_MS/);
  assert.match(probe, /MercadoPagoProbe\.probeCredential/);
  assert.match(probe, /body: \{ status: "canceled" \}/);
  assert.match(probe, /authorized_payments\/search/);
  assert.doesNotMatch(probe, /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEYS/);
});

test("subscription sandbox probe can only run from an explicit workflow dispatch", () => {
  assert.match(workflow, /run_subscription_probe:/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.run_subscription_probe == true/,
  );
  assert.match(workflow, /MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN/);
  assert.match(workflow, /MERCADO_PAGO_SUBSCRIPTION_STAGE_PUBLIC_KEY/);
  assert.doesNotMatch(workflow, /MERCADO_PAGO_SUBSCRIPTION_SANDBOX_PAYER_EMAIL/);
  assert.match(workflow, /node scripts\/mercado_pago_subscription_sandbox_probe\.js/);
});
