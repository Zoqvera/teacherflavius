const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

test("webhook uses Mercado Pago notification id as the primary deduplication identity", () => {
  const source = read("supabase/functions/mercado-pago-webhook/index.ts");

  assert.match(source, /mercado_pago\|notification\|\$\{options\.providerEventId\}/);
  assert.match(source, /providerEventId = cleanIdentifier\(payload\.id, 128\)/);
  assert.match(source, /register_mercado_pago_webhook_event/);
  assert.match(source, /begin_mercado_pago_webhook_processing/);
  assert.match(source, /finish_mercado_pago_webhook_event/);
});

test("safe replay re-fetches provider state instead of replaying stored payload", () => {
  const source = read("supabase/functions/replay-mercado-pago-webhook/index.ts");
  const sharedSync = read("supabase/functions/_shared/mercado_pago_payment_sync.ts");

  assert.match(source, /synchronizeMercadoPagoPayment/);
  assert.match(source, /is_teacher_admin_mfa/);
  assert.doesNotMatch(source, /payload\s*:/i);
  assert.match(sharedSync, /api\.mercadopago\.com\/v1\/payments/);
  assert.match(sharedSync, /process_mercado_pago_payment/);
});

test("webhook audit listing is protected by JWT and administrative MFA in source", () => {
  const source = read("supabase/functions/list-payment-webhooks/index.ts");

  assert.match(source, /is_teacher_admin_mfa/);
  assert.match(source, /payment_webhook_events/);
  assert.doesNotMatch(source, /deduplication_key/);
  assert.doesNotMatch(source, /request_id/);
  assert.doesNotMatch(source, /metadata/);
});
