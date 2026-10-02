const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20260928225003_add_mercado_pago_subscription_reconciliation.sql",
);
const syncSource = read(
  "supabase/functions/_shared/mercado_pago_subscription_sync.ts",
);
const webhookSource = read(
  "supabase/functions/mercado-pago-webhook/index.ts",
);
const replaySource = read(
  "supabase/functions/replay-mercado-pago-webhook/index.ts",
);

test("recurring invoices are preserved as server-only financial records", () => {
  assert.match(migration, /create table public\.subscription_authorized_payments/i);
  assert.match(migration, /subject_ref uuid not null/i);
  assert.match(migration, /student_id uuid references public\.profiles\(id\) on delete set null/i);
  assert.match(migration, /subscription_id uuid references public\.student_subscriptions\(id\) on delete set null/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all privileges on table public\.subscription_authorized_payments from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.subscription_authorized_payments to service_role/i,
  );
  const baseline = read(
    "supabase/baseline/75_add_mercado_pago_subscription_reconciliation.sql",
  );
  assert.match(baseline, /create or replace function public\.preserve_financial_subject_ref\(\)/i);
});

test("subscription reconciliation derives tuition cycle from the provider debit date", () => {
  assert.match(migration, /target_debit_date at time zone 'America\/Sao_Paulo'/i);
  assert.match(migration, /insert into public\.monthly_tuition/i);
  assert.match(migration, /on conflict \(student_id, reference_month\) do nothing/i);
  assert.match(migration, /tuition_amount_mismatch/i);
  assert.match(migration, /tuition_exempt/i);
  assert.match(migration, /duplicate_payment_detected/i);
  assert.match(migration, /Mercado Pago · assinatura · pagamento/i);
});

test("recurring payment application is idempotent and handles reversals", () => {
  assert.match(
    migration,
    /unique \(provider, provider_authorized_payment_id\)/i,
  );
  assert.match(
    migration,
    /subscription_authorized_payments_provider_payment_idx/i,
  );
  assert.match(migration, /payment_recorded/i);
  assert.match(migration, /payment_reinstated/i);
  assert.match(migration, /payment_reversed/i);
  assert.match(migration, /normalized_payment_status in \('cancelled', 'refunded', 'charged_back'\)/i);
});

test("subscription synchronizer re-fetches authoritative Mercado Pago resources", () => {
  assert.match(syncSource, /api\.mercadopago\.com\/preapproval\//);
  assert.match(syncSource, /api\.mercadopago\.com\/authorized_payments\//);
  assert.match(syncSource, /authorized_payments\/search\?payment_id=/);
  assert.match(syncSource, /api\.mercadopago\.com\/v1\/payments\//);
  assert.match(syncSource, /process_mercado_pago_subscription_invoice/);
  assert.match(syncSource, /subscription_amount_mismatch/);
  assert.match(syncSource, /authorized_payment_reference_mismatch/);
});

test("provider canceled status maps to the local cancelled lifecycle state", () => {
  assert.match(
    syncSource,
    /status === "canceled" \|\| status === "cancelled"\) return "cancelled"/,
  );
});

test("production webhook processes both subscription event topics", () => {
  assert.match(webhookSource, /subscription_preapproval/);
  assert.match(webhookSource, /subscription_authorized_payment/);
  assert.match(webhookSource, /synchronizeMercadoPagoSubscription/);
  assert.match(webhookSource, /synchronizeMercadoPagoAuthorizedPayment/);
  assert.match(webhookSource, /trySynchronizeMercadoPagoSubscriptionPayment/);
  assert.match(webhookSource, /provider_resource_id/);
  assert.doesNotMatch(webhookSource, /raw_payload|payload_body|stored_payload/i);
});

test("administrative replay supports subscription events with teacher admin authorization", () => {
  assert.match(replaySource, /is_teacher_admin/);
  assert.match(replaySource, /subscription_preapproval/);
  assert.match(replaySource, /subscription_authorized_payment/);
  assert.match(replaySource, /synchronizeMercadoPagoSubscription/);
  assert.match(replaySource, /synchronizeMercadoPagoAuthorizedPayment/);
  assert.doesNotMatch(replaySource, /payload_body|stored_payload/i);
});
