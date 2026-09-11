const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const settlement = read("supabase/migrations/20260909194701_fix_mercado_pago_duplicate_detection_null_semantics.sql");
const sharedSync = read("supabase/functions/_shared/mercado_pago_payment_sync.ts");
const probe = read("supabase/functions/payment-concurrency-probe/index.ts");

test("production settlement serializes attempt and tuition mutations", () => {
  const rowLocks = settlement.match(/for update;/gi) ?? [];
  assert.ok(rowLocks.length >= 2, "expected row locks for attempt and tuition");
  assert.match(settlement, /from public\.tuition_payment_attempts[\s\S]*for update;/i);
  assert.match(settlement, /from public\.monthly_tuition[\s\S]*for update;/i);
});

test("approved payment application remains exactly-once after lock acquisition", () => {
  assert.match(settlement, /where id = tuition_row\.id[\s\S]*and payment_date is null[\s\S]*and not is_exempt;/i);
  assert.match(settlement, /payment_was_applied := affected_count > 0;/);
  assert.match(settlement, /if payment_was_applied then[\s\S]*'payment_recorded'/i);
  assert.match(settlement, /tuition_row\.payment_provider = 'mercado_pago'[\s\S]*tuition_row\.provider_payment_id = normalized_provider_payment_id/i);
});

test("webhook-style synchronization and reconciler converge through the same settlement RPC", () => {
  assert.match(sharedSync, /synchronizeMercadoPagoPayment/);
  assert.match(sharedSync, /\.rpc\(\s*"process_mercado_pago_payment"/);
  assert.match(probe, /synchronizeMercadoPagoPayment/);
  assert.match(probe, /validate_mercado_pago_reconciliation_signature/);
});

test("concurrency probe is internal, freshness-bound, and does not accept browser auth", () => {
  assert.match(probe, /AUTH_TIMESTAMP_TOLERANCE_MS = 5 \* 60 \* 1000/);
  assert.match(probe, /x-reconciliation-timestamp/);
  assert.match(probe, /x-reconciliation-signature/);
  assert.doesNotMatch(probe, /SUPABASE_ANON_KEY/);
  assert.doesNotMatch(probe, /Access-Control-Allow-Origin/);
});
