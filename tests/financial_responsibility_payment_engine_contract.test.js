const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sql = fs.readFileSync(path.join(
  __dirname, "..", "supabase/migrations/20261107144500_financial_responsibility_payment_engine.sql"
), "utf8");

test("a sponsored checkout quotes each independent tuition at its own amount", () => {
  assert.match(sql, /private\.quote_financial_responsibility_payment/);
  assert.match(sql, /primary_tuition\.amount_due/);
  assert.match(sql, /dependent_tuition\.amount_due/);
  assert.match(sql, /'role', 'beneficiary'/);
  assert.match(sql, /total := total \+ round\(dependent_tuition\.amount_due, 2\)/);
});

test("beneficiary cannot pay a covered month under their own login", () => {
  assert.match(sql, /Esta mensalidade é paga pelo responsável financeiro/);
  assert.match(sql, /beneficiary_student_id = target_payer_id/);
});

test("snapshot is immutable and confirms exact total before provider call", () => {
  assert.match(sql, /round\(attempt_row\.amount, 2\) is distinct from \(quote ->> 'total'\)::numeric/);
  assert.match(sql, /on conflict \(attempt_id, tuition_id\) do nothing/);
  assert.match(sql, /O rateio anterior não corresponde à cobrança imutável/);
  assert.match(sql, /for update/);
});

test("settlement and reversal are atomic across tuition records", () => {
  assert.match(sql, /public\.process_financial_responsibility_payment/);
  assert.match(sql, /'payment_recorded'/);
  assert.match(sql, /'payment_reversed'/);
  assert.match(sql, /normalized_status in \('cancelled','refunded','charged_back'\)/);
  assert.match(sql, /O estorno não foi integral/);
  assert.match(sql, /já estornado não pode ser reaplicado automaticamente/);
});

test("only trusted payment server may create allocations or invoke settlement", () => {
  assert.match(sql, /current_setting\('request\.jwt\.claim\.role', true\)/);
  assert.match(sql, /grant execute on function public\.reserve_financial_responsibility_payment\(uuid,uuid\) to service_role/);
  assert.match(sql, /grant execute on function public\.process_financial_responsibility_payment/);
  assert.match(sql, /revoke all on private\.financial_responsibility_payment_items from anon, authenticated/);
});

test("payment gateway integration is deliberately absent until verified", () => {
  assert.doesNotMatch(sql, /create or replace function public\.process_mercado_pago_payment\(/i);
  assert.doesNotMatch(sql, /update public\.student_billing_settings/i);
});
