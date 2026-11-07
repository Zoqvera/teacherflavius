const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const integrity = source("supabase/migrations/20261107160000_financial_responsibility_integrity_audit.sql");
const unarchive = source("supabase/migrations/20261107162000_resume_billing_after_unarchive.sql");
const alignment = source("supabase/migrations/20261107162500_unarchive_due_date_alignment.sql");
const refund = source("supabase/migrations/20261107164000_financial_refund_full_transaction_amount.sql");
const atomicity = source("supabase/migrations/20261107165000_sponsored_settlement_atomicity_guard.sql");
const admin = source("financial_responsibilities_admin.js");
const finance = source("mensalidades.js");
const financeHtml = source("mensalidades.html");

test("archiving either party ends their responsibility without deleting history", () => {
  assert.match(integrity, /relationship\.payer_student_id = new\.id or relationship\.beneficiary_student_id = new\.id|link\.payer_student_id = new\.id or link\.beneficiary_student_id = new\.id/i);
  assert.match(integrity, /before update of archived on public\.profiles/i);
  assert.match(integrity, /first_uncovered_month = cutoff/i);
  assert.match(integrity, /invoice\.payment_date is not null or invoice\.is_exempt/i);
  assert.match(integrity, /attempt\.status in \([\s\S]*?'created'/i);
  assert.doesNotMatch(integrity, /delete from private\.student_financial_responsibilities/i);
});

test("unarchiving resumes monthly billing without restoring archived classes", () => {
  assert.match(unarchive, /after update of archived on public\.profiles/i);
  assert.match(unarchive, /billing_exemption = 'permanent'/i);
  assert.match(unarchive, /first_tuition_due_date_after\(today_local,billing\.due_day\)/i);
  assert.match(unarchive, /set active=true,/i);
  assert.match(alignment, /effective_due := case/);
  assert.match(alignment, /tuition_first_due_date=effective_due/);
  assert.doesNotMatch(unarchive, /insert into public\.class_students/i);
});

test("paid months cannot be retrospectively reassigned, and linked students share due days", () => {
  assert.match(integrity, /first_uncovered_month date/i);
  assert.match(integrity, /Há mensalidades pagas nesse período/i);
  assert.match(integrity, /count\(distinct billing\.due_day\)/i);
  assert.match(integrity, /payer_invoice\.due_date <> beneficiary_invoice\.due_date/i);
  assert.match(integrity, /O responsável financeiro está inativo ou arquivado/i);
  assert.match(integrity, /Um aluno beneficiário está inativo ou arquivado/i);
});

test("refund candidates show total gateway amount and reject unbalanced split", () => {
  assert.match(refund, /total_refund_amount := case when item_count > 0/i);
  assert.match(refund, /then round\(attempt_row\.amount,2\)/i);
  assert.match(refund, /'amount', total_refund_amount/i);
  assert.match(refund, /As mensalidades vinculadas não estão conciliadas para reembolso integral/i);
  assert.match(refund, /then attempt\.amount else tuition\.amount_paid end/i);
});

test("partial manual settlements and partial group reversals fail closed", () => {
  assert.match(atomicity, /guard_sponsored_invoice_manual_settlement/i);
  assert.match(atomicity, /before update of payment_date,amount_paid,is_exempt on public\.monthly_tuition/i);
  assert.match(atomicity, /Esta mensalidade integra uma cobrança consolidada/i);
  assert.match(atomicity, /deferrable initially deferred/i);
  assert.match(atomicity, /Pagamento consolidado parcialmente quitado/i);
  assert.match(atomicity, /Valores divergentes no rateio/i);
});

test("financial dashboard attributes beneficiary invoices to payer", () => {
  assert.match(finance, /get_teacher_financial_responsibilities/);
  assert.match(finance, /getTuitionPayerLabel\(item\)/);
  assert.match(finance, /getFinancialContextLabel\(item\)/);
  assert.match(finance, /hasConsolidatedFinancialResponsibility\(item\)/);
  assert.match(finance, /Responsabilidade financeira/);
  assert.match(finance, /Pagante responsável/);
  assert.match(finance, /GERENCIAR COBRANÇA CONSOLIDADA/);
  assert.match(financeHtml, /mensalidades\.js\?v=20261107-audit-1/);
});

test("student payer picker only offers same-due-date active payers", () => {
  assert.match(admin, /beneficiaryDueDay/);
  assert.match(admin, /Number\(row\.due_day\) === beneficiaryDueDay/);
  assert.match(admin, /get_teacher_billing_students/);
});

test("no new website text contains the disallowed term", () => {
  assert.doesNotMatch(admin, /\bonline\b/i);
  assert.doesNotMatch(finance, /\bonline\b/i);
});
