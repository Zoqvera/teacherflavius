const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20261004081243_align_first_tuition_with_lesson_start_month.sql"
  ),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/baseline/150_align_first_tuition_with_lesson_start_month.sql"
  ),
  "utf8"
);

function assertServiceMonthContract(sql) {
  assert.match(
    sql,
    /target_reference_month := billing_row\.billing_start_month/i
  );
  assert.doesNotMatch(
    sql,
    /target_reference_month := date_trunc\('month', target_first_due_date\)/i
  );
  assert.match(
    sql,
    /start_month := date_trunc\([\s\S]*timezone\('America\/Sao_Paulo', now\(\)\)::date[\s\S]*\)::date/i
  );
}

test("first tuition uses the lesson start month independently from its due date", function () {
  assertServiceMonthContract(migration);
  assertServiceMonthContract(baseline);
});

test("automatic enrollment fallback keeps billing start in the enrollment month", function () {
  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /billing_start_month = date_trunc\([\s\S]*timezone\('America\/Sao_Paulo', now\(\)\)::date[\s\S]*\)::date/i
    );
  }
});

test("current-month enrollment repair moves only credit-free first tuition rows", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /settings\.billing_start_month > clock\.current_month/i);
    assert.match(sql, /tuition\.reference_month = settings\.billing_start_month/i);
    assert.match(sql, /from private\.lesson_credits credit/i);
    assert.match(sql, /credit\.tuition_id = tuition\.id/i);
    assert.match(sql, /reference_month = candidate\.current_month/i);
  }
});

test("a settled repaired first tuition seeds the next service month without changing the two-day visibility rule", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /paid_first as \(/i);
    assert.match(sql, /tuition\.payment_date is not null/i);
    assert.match(sql, /paid\.reference_month \+ interval '1 month'/i);
    assert.match(sql, /on conflict \(student_id, reference_month\) do nothing/i);
  }
});
