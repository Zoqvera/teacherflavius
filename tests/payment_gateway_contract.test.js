const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const createPaymentSource = read("supabase/functions/create-mercado-pago-payment/index.ts");
const webhookSource = read("supabase/functions/mercado-pago-webhook/index.ts");
const replaySource = read("supabase/functions/replay-mercado-pago-webhook/index.ts");
const listSource = read("supabase/functions/list-payment-webhooks/index.ts");
const syncSource = read("supabase/functions/_shared/mercado_pago_payment_sync.ts");
const gatewayFailureMigration = read(
  "supabase/migrations/20260911025109_capture_mercado_pago_policy_gateway_failures.sql",
);

test("payment creation preserves server-side amount and provider idempotency contracts", () => {
  assert.match(createPaymentSource, /\.from\("monthly_tuition"\)/);
  assert.match(createPaymentSource, /const amount = Number\(tuition\.amount_due\)/);
  assert.match(createPaymentSource, /"X-Idempotency-Key": idempotencyKey/);
  assert.match(createPaymentSource, /external_reference:\s*attempt\.id/);
  assert.match(createPaymentSource, /process_mercado_pago_payment/);
});

test("payment creation distinguishes Pix and card policy failures", () => {
  assert.match(createPaymentSource, /type SupportedPaymentMethod = "pix" \| "card"/);
  assert.match(createPaymentSource, /mercado_pago_pix_temporarily_unavailable/);
  assert.match(createPaymentSource, /mercado_pago_card_temporarily_unavailable/);
  assert.match(createPaymentSource, /policyFallbackMessage\(paymentMethod, professorNotified\)/);
  assert.match(createPaymentSource, /policyBlockCode\(paymentMethod\)/);
  assert.match(
    createPaymentSource,
    /mercado-pago-policy-\$\{input\.paymentMethod\}-\$\{input\.providerErrorCode\}-\$\{dayKey\}/,
  );
});

test("gateway observability captures provider outages and Mercado Pago policy blocks", () => {
  assert.match(gatewayFailureMigration, /provider_http_\(429\|5\[0-9\]\{2\}\)_/);
  assert.match(
    gatewayFailureMigration,
    /provider_http_403_pa_unauthorized_result_from_policies/,
  );
  assert.match(gatewayFailureMigration, /'gateway_failure'/);
  assert.match(gatewayFailureMigration, /payment_operational_events/);
});

test("webhook validates HMAC before accepting and persisting valid notifications", () => {
  const validationIndex = webhookSource.indexOf("validateSignature(");
  const registrationIndex = webhookSource.indexOf("registerWebhook(", validationIndex);

  assert.notEqual(validationIndex, -1);
  assert.notEqual(registrationIndex, -1);
  assert.ok(validationIndex < registrationIndex);
  assert.match(webhookSource, /constantTimeEqual/);
  assert.match(webhookSource, /mercado_pago\|notification\|\$\{options\.providerEventId\}/);
  assert.match(webhookSource, /delivery_count/);
});

test("shared synchronization re-queries Mercado Pago and validates local payment identity", () => {
  assert.match(syncSource, /https:\/\/api\.mercadopago\.com\/v1\/payments\//);
  assert.match(syncSource, /payment\.external_reference/);
  assert.match(syncSource, /returnedPaymentId !== options\.paymentId/);
  assert.match(syncSource, /Number\(attempt\.amount\)\.toFixed\(2\) !== amount\.toFixed\(2\)/);
  assert.match(syncSource, /attempt\.provider_payment_id && attempt\.provider_payment_id !== returnedPaymentId/);
  assert.match(syncSource, /process_mercado_pago_payment/);
});

test("administrative replay uses MFA and current gateway state instead of stored payload", () => {
  assert.match(replaySource, /rpc\("is_teacher_admin_mfa"\)/);
  assert.match(replaySource, /synchronizeMercadoPagoPayment/);
  assert.match(replaySource, /provider_payment_id/);
  assert.doesNotMatch(replaySource, /stored_payload|raw_payload|payload_body/);
});

test("webhook listing requires administrative MFA and exposes a bounded technical history", () => {
  assert.match(listSource, /rpc\("is_teacher_admin_mfa"\)/);
  assert.match(listSource, /\.from\("payment_webhook_events"\)/);
  assert.match(listSource, /Math\.min/);
  assert.match(listSource, /id, provider_payment_id, event_type, action, status, delivery_count/);
  assert.doesNotMatch(listSource, /raw_payload|payload_body/);
});
