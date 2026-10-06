const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261006204500_fix_enrollment_billing_reference_month.sql"
);
const baseline = read(
  "supabase/baseline/275_fix_enrollment_billing_reference_month.sql"
);
const nextCycleMigration = read(
  "supabase/migrations/20261001015000_unlock_next_tuition_two_days_after_payment.sql"
);
const tuitionSchema = read("supabase_mensalidades.sql");

function assertInitialReferenceMonthUsesFirstDueDate(sql) {
  assert.match(
    sql,
    /start_month := date_trunc\(\s*'month',\s*first_due_date\s*\)::date/i
  );
  assert.doesNotMatch(
    sql,
    /start_month := date_trunc\([\s\S]{0,160}timezone\('America\/Sao_Paulo', now\(\)\)::date[\s\S]{0,80}\)::date/i
  );
}

test("initial tuition competence follows the first due date across month boundaries", function () {
  assertInitialReferenceMonthUsesFirstDueDate(migration);
  assertInitialReferenceMonthUsesFirstDueDate(baseline);

  const boundaryCases = [
    { enrollmentDate: "2026-10-31", firstDueDate: "2026-11-01", expectedReferenceMonth: "2026-11-01" },
    { enrollmentDate: "2026-12-31", firstDueDate: "2027-01-01", expectedReferenceMonth: "2027-01-01" },
    { enrollmentDate: "2028-02-29", firstDueDate: "2028-03-01", expectedReferenceMonth: "2028-03-01" }
  ];

  for (const scenario of boundaryCases) {
    assert.notEqual(
      scenario.enrollmentDate.slice(0, 7),
      scenario.firstDueDate.slice(0, 7)
    );
    assert.equal(
      scenario.firstDueDate.slice(0, 7) + "-01",
      scenario.expectedReferenceMonth
    );
  }
});

test("repair only advances billing starts created before the first due-date month", function () {
  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /settings\.billing_start_month\s*<\s*date_trunc\('month', profile\.tuition_first_due_date\)::date/i
    );
    assert.doesNotMatch(
      sql,
      /settings\.billing_start_month\s*>\s*date_trunc\('month', profile\.tuition_first_due_date\)::date/i
    );
  }
});

test("next tuition advances from the settled competence rather than the current calendar month", function () {
  assert.match(
    nextCycleMigration,
    /date_trunc\('month', new\.reference_month::timestamp\)[\s\S]*\+ interval '1 month'/i
  );
  assert.doesNotMatch(
    nextCycleMigration,
    /next_reference_month\s*:=\s*date_trunc\('month',\s*current_date/i
  );
});

test("the first future competence remains immediately visible to the student", function () {
  assert.match(
    nextCycleMigration,
    /mt\.reference_month = settings\.billing_start_month/i
  );
  assert.match(
    nextCycleMigration,
    /previous_tuition\.payment_date <= local_today - 2/i
  );
});

test("monthly tuition keeps one row per student and competence", function () {
  assert.match(
    tuitionSchema,
    /unique \(student_id, reference_month\)/i
  );
});
