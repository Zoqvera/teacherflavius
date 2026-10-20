"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const migration = read("supabase/migrations/20261020132500_late_payment_policy_quote_foundation.sql");
const baseline = read("supabase/baseline/435_late_payment_policy_quote_foundation.sql");
const checkout = read("pagamento/index.html");
const consent = read("pagamento/late_payment_terms.js");
const gateway = read("supabase/functions/create-mercado-pago-payment/index.ts");
const settlement = read("supabase/baseline/10_public_schema.sql");

test("the production migration and disaster-recovery overlay remain identical", () => {
  assert.equal(migration, baseline);
});

test("fee calculation is isolated, simple, fixed-rate, and non-retroactive", () => {
  assert.match(migration, /private\.calculate_late_payment_components/);
  assert.match(migration, /eligible_days := greatest\(0, as_of - greatest\(due_on, effective_on\)\)/);
  assert.match(migration, /fine := round\(base \* 0\.02, 2\)/);
  assert.match(migration, /interest := round\(base \* 0\.01 \* eligible_days \/ 30, 2\)/);
  assert.match(migration, /timezone\('America\/Sao_Paulo', now\(\)\)::date/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition\b/i);
  assert.doesNotMatch(migration, /alter table public\.monthly_tuition\b/i);
});

test("acceptance is explicit, versioned, authenticated and denies minors", () => {
  assert.match(migration, /private\.student_policy_acceptances/);
  assert.match(migration, /on conflict \(student_id, policy_key, policy_version\) do nothing/i);
  assert.match(migration, /'tuition-late-payment'/);
  assert.match(migration, /'2026-10-20-v1'/);
  assert.match(migration, /profile_row\.date_of_birth/);
  assert.match(migration, /revoke all on function public\.accept_my_late_payment_terms\(text\)/i);
  assert.match(migration, /grant execute on function public\.accept_my_late_payment_terms\(text\)[\s\S]*authenticated, service_role/i);
  assert.match(migration, /where t\.id = target_tuition_id and t\.student_id = caller_id/);
});

test("checkout never forces new terms as a precondition for paying", () => {
  assert.match(checkout, /id="latePaymentTermsCheckbox"/);
  assert.match(checkout, /id="latePaymentTermsAcceptButton"/);
  assert.match(checkout, /concordância é voluntária/i);
  assert.match(checkout, /valor(?:es)? originais/i);
  assert.match(consent, /get_my_late_payment_terms/);
  assert.match(consent, /accept_my_late_payment_terms/);
  assert.match(consent, /if \(!checkbox\.checked \|\| button\.disabled\) return/);
  assert.match(checkout, /noindex, nofollow/);
  assert.match(checkout, /late_payment_terms\.js/);
});

test("backend payment creation and settlement remain unchanged in this opt-in foundation", () => {
  assert.match(gateway, /const amount = Number\(tuition\.amount_due\)/);
  assert.match(settlement, /monthly_tuition/);
  assert.match(migration, /'billing_enabled', false/);
  assert.match(migration, /'preview_only', true/);
  assert.match(migration, /attempt_amount is not null/);
});

test("canonical restore includes the new overlay and account functions", () => {
  const workflow = read(".github/workflows/validate-supabase-baseline.yml");
  const fingerprint = JSON.parse(read("supabase/baseline/schema-fingerprint.json"));
  assert.match(workflow, /435_late_payment_policy_quote_foundation\.sql/);
  assert.equal(fingerprint.public_functions, 196);
  assert.equal(fingerprint.private_functions, 39);
});
