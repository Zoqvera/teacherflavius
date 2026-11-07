const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const routing = source("supabase/migrations/20261107151000_financial_responsibility_checkout_routing.sql");
const settlement = source("supabase/migrations/20261107152000_financial_responsibility_unique_provider_settlement.sql");
const gateway = source("supabase/functions/create-mercado-pago-payment/index.ts");
const portal = source("pagamento/app.js");
const admin = source("financial_responsibilities_admin.js");
const profiles = source("perfil_dos_alunos.js");
const profilesHtml = source("perfil_dos_alunos.html");
const paymentHtml = source("pagamento/index.html");
const notices = source("student_payment_service.js");

test("legacy Mercado Pago processor routes only captured group-payment attempts", () => {
  assert.match(routing, /create or replace function public\.process_mercado_pago_payment\(/i);
  assert.match(routing, /from private\.financial_responsibility_payment_items group_item/i);
  assert.match(routing, /return public\.process_financial_responsibility_payment\(/i);
  assert.match(routing, /split_is_valid := private\.has_valid_mercado_pago_split/i);
});

test("server derives sponsored total and never accepts a browser supplied amount", () => {
  assert.match(gateway, /get_financial_responsibility_payment_quote_internal/);
  assert.match(gateway, /const chargeAmount = Number\(financialQuote\.total\)/);
  assert.match(gateway, /amount: chargeAmount/);
  assert.match(gateway, /transaction_amount: chargeAmount/);
  assert.match(gateway, /reserve_financial_responsibility_payment/);
  assert.match(gateway, /reservation\?\.sponsored !== true/);
  assert.doesNotMatch(gateway, /amount:\s*body\.amount/);
});

test("portal displays itemized sponsored invoices and charges the quoted total", () => {
  assert.match(portal, /get_my_financial_responsibility_quote/);
  assert.match(portal, /checkout_total: total/);
  assert.match(portal, /item\.student_name/);
  assert.match(portal, /amount: Number\(selectedTuition\.checkout_total\)/);
  assert.match(portal, /get_my_financial_responsibility_coverage/);
  assert.match(notices, /get_my_financial_responsibility_quote/);
  assert.match(paymentHtml, /financial-responsibility-1/);
});

test("beneficiary direct checkout is blocked at both query and payment attempt layers", () => {
  assert.match(routing, /and not exists \([\s\S]*?link\.beneficiary_student_id = current_user_id/);
  assert.match(routing, /before insert[\s\S]*?on public\.tuition_payment_attempts/);
  assert.match(routing, /Esta mensalidade deve ser paga pelo responsável financeiro/);
  assert.match(routing, /get_my_financial_responsibility_coverage/);
});

test("consolidated settlement respects unique provider payment index", () => {
  assert.match(settlement, /payment_provider = case when invoice\.id = attempt_row\.tuition_id/);
  assert.match(settlement, /provider_payment_id = case when invoice\.id = attempt_row\.tuition_id/);
  assert.match(settlement, /monthly_tuition_events evidence/);
  assert.match(settlement, /evidence\.details ->> 'attempt_id' = target_attempt_id::text/);
  assert.match(settlement, /'payment_reversed'/);
  assert.match(settlement, /payment_reversed',reversed_count > 0/);
});

test("sponsorship cannot coexist with active recurring subscription", () => {
  assert.match(routing, /protect_sponsored_subscription_collision/);
  assert.match(routing, /on private\.student_financial_responsibilities/);
  assert.match(routing, /on public\.student_subscriptions/);
  assert.match(routing, /'draft','paused','cancelled','rejected'/);
});

test("teacher-only manager supports create and end with a start month", () => {
  assert.match(admin, /get_teacher_financial_responsibilities/);
  assert.match(admin, /set_teacher_financial_responsibility/);
  assert.match(admin, /end_teacher_financial_responsibility/);
  assert.match(admin, /Responsabilidade financeira/);
  assert.match(profiles, /financial-responsibility-button/);
  assert.match(profiles, /FinancialResponsibilitiesAdmin\.renderSummary/);
  assert.match(profilesHtml, /id="financialResponsibilityModal"/);
  assert.match(profilesHtml, /financial_responsibilities_admin\.js/);
});

test("no new public SEO text or disallowed terminology is introduced", () => {
  assert.doesNotMatch(admin, /\bonline\b/i);
  assert.doesNotMatch(settlement, /update public\.student_billing_settings/i);
});
