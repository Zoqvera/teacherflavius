const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261001015000_unlock_next_tuition_two_days_after_payment.sql"
);
const paymentSql = read("supabase_mercado_pago.sql");
const presenter = read("student_payment_notice_presenter.js");
const baselineWorkflow = read(".github/workflows/validate-supabase-baseline.yml");

test("payment settlement prepares exactly the next monthly tuition", function () {
  assert.match(migration, /prepare_next_tuition_after_payment/);
  assert.match(migration, /after insert or update of payment_date on public\.monthly_tuition/i);
  assert.match(
    migration,
    /date_trunc\('month', new\.reference_month::timestamp\)[\s\S]*interval '1 month'/i
  );
  assert.match(migration, /on conflict \(student_id, reference_month\) do update/i);
  assert.match(migration, /monthly_tuition\.amount_override/i);
});

test("future tuition becomes payable only two days after the previous payment", function () {
  const unlockRule = /previous_tuition\.payment_date <= local_today - 2/i;
  assert.match(migration, unlockRule);
  assert.match(paymentSql, unlockRule);
  assert.match(
    migration,
    /previous_tuition\.reference_month = \([\s\S]*mt\.reference_month::timestamp[\s\S]*interval '1 month'[\s\S]*\)::date/i
  );
});

test("first tuition stays immediately payable and later future cycles require a paid predecessor", function () {
  assert.match(migration, /mt\.reference_month = settings\.billing_start_month/i);
  assert.match(migration, /or exists \([\s\S]*previous_tuition\.payment_date is not null/i);
  assert.doesNotMatch(migration, /mt\.reference_month > settings\.billing_start_month/i);
});

test("early availability does not broaden payment notices", function () {
  assert.match(presenter, /"due_in_two_days"/);
  assert.match(presenter, /"due_tomorrow"/);
  assert.match(presenter, /"due_today"/);
  assert.doesNotMatch(
    presenter,
    /UPCOMING_PAYMENT_STATUSES[\s\S]*"open"[\s\S]*\]\)/
  );
});

test("recovery baseline includes the early-next-tuition overlay", function () {
  assert.match(
    baselineWorkflow,
    /95_unlock_next_tuition_two_days_after_payment\.sql/
  );
});
