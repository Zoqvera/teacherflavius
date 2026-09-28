const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20260928223029_add_mercado_pago_subscription_foundation.sql",
);
const functionSource = read(
  "supabase/functions/create-mercado-pago-subscription/index.ts",
);
const baselineOverlay = read(
  "supabase/baseline/70_add_mercado_pago_subscription_foundation.sql",
);

test("subscription persistence is server-only and enforces one current contract per student", () => {
  assert.match(migration, /create table public\.student_subscriptions/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all privileges on table public\.student_subscriptions from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant select, insert, update, delete on table public\.student_subscriptions to service_role/i,
  );
  assert.match(
    migration,
    /student_subscriptions_one_current_per_student_idx[\s\S]*status in \('draft', 'pending', 'authorized', 'paused'\)/i,
  );
});

test("subscription records never store card credentials", () => {
  assert.doesNotMatch(migration, /card_number|security_code|cvv|expiration_month|expiration_year/i);
  assert.doesNotMatch(migration, /card_token_id/i);
});

test("subscription creation derives commercial terms from server billing settings", () => {
  assert.match(functionSource, /\.from\("student_billing_settings"\)/);
  assert.match(functionSource, /\.select\("monthly_fee, due_day, active"\)/);
  assert.match(functionSource, /const amount = Number\(settings\?\.monthly_fee\)/);
  assert.match(functionSource, /const dueDay = Number\(settings\?\.due_day\)/);
  assert.doesNotMatch(functionSource, /body\.amount|body\.due_day|body\.payer_email/);
});

test("provider creation is feature-gated and idempotent", () => {
  assert.match(functionSource, /MERCADO_PAGO_SUBSCRIPTIONS_ENABLED/);
  assert.match(functionSource, /subscriptions_not_enabled/);
  assert.match(functionSource, /https:\/\/api\.mercadopago\.com\/preapproval/);
  assert.match(functionSource, /"X-Idempotency-Key": subscription\.idempotency_key/);
  assert.match(functionSource, /external_reference: subscription\.external_reference/);
  assert.match(functionSource, /status: "authorized"/);
});

test("subscription starts on the next monthly cycle", () => {
  assert.match(functionSource, /const firstChargeDate = calculateFirstChargeDate\(dueDay\)/);
  assert.match(functionSource, /let month = today\.month \+ 1/);
  assert.match(functionSource, /start_date: firstChargeIso\(subscription\.first_charge_date\)/);
  assert.match(functionSource, /frequency: 1/);
  assert.match(functionSource, /frequency_type: "months"/);
  assert.match(functionSource, /currency_id: "BRL"/);
});

test("restore baseline includes the subscription foundation", () => {
  assert.match(baselineOverlay, /create table public\.student_subscriptions/i);
  assert.match(baselineOverlay, /student_subscriptions_one_current_per_student_idx/i);
  assert.match(baselineOverlay, /revoke all privileges on table public\.student_subscriptions/i);
});
