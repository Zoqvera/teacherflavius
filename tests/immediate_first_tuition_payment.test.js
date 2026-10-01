const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const profileScript = read("perfil_dos_alunos.js");
const dueDayScript = read("perfil_dos_alunos_vencimento.js");
const paymentSql = read("supabase_mercado_pago.sql");
const migration = read("supabase/migrations/20261001013000_enable_immediate_first_tuition_payment.sql");

test("teacher fee save generates the first bill even when billing starts next month", function () {
  assert.match(profileScript, /billingStartMonth > currentBillingMonth/);
  assert.match(profileScript, /target_reference_month: generationMonth/);
  assert.match(dueDayScript, /billingStartMonth > currentBillingMonth/);
  assert.match(dueDayScript, /target_reference_month: generationMonth/);
});

test("student can see the first billing cycle before its calendar month begins", function () {
  const expectedRule = /mt\.reference_month = settings\.billing_start_month/;
  assert.match(paymentSql, expectedRule);
  assert.match(migration, expectedRule);
  assert.match(paymentSql, /mt\.reference_month <= date_trunc\('month', local_today\)::date/);
});

test("later future billing cycles remain hidden and financial dates use Sao Paulo time", function () {
  assert.match(migration, /timezone\('America\/Sao_Paulo', now\(\)\)::date/);
  assert.doesNotMatch(migration, /mt\.reference_month > settings\.billing_start_month/);
  assert.match(migration, /when mt\.due_date = local_today \+ 2 then 'due_in_two_days'/);
});
