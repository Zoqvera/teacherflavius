const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006015100_activate_first_prepaid_tuition.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/235_activate_first_prepaid_tuition.sql"),
  "utf8"
);

for (const sql of [migration, baseline]) {
  test("first settled tuition starts when the first payment or exemption becomes effective", function () {
    assert.match(sql, /create or replace function private\.get_tuition_coverage_start/i);
    assert.match(sql, /previous_tuition\.reference_month < tuition\.reference_month/i);
    assert.match(sql, /tuition\.payment_date/i);
    assert.match(sql, /tuition\.exempted_at at time zone 'America\/Sao_Paulo'/i);
  });

  test("coverage ends at the next billing reference even when two invoices share the same due date", function () {
    assert.match(sql, /next_tuition\.reference_month > tuition\.reference_month/i);
    assert.match(sql, /select min\(next_tuition\.due_date\)/i);
  });

  test("paid access uses the effective coverage window instead of waiting for the due date", function () {
    assert.match(sql, /private\.get_tuition_coverage_start\(tuition\.id\) <= target_date/i);
    assert.match(sql, /target_date < private\.get_tuition_coverage_end\(tuition\.id\)/i);
    assert.doesNotMatch(sql, /and tuition\.due_date <= target_date/i);
  });

  test("lesson cards are generated from the effective first coverage date", function () {
    assert.match(sql, /coverage_start := private\.get_tuition_coverage_start\(tuition_row\.id\)/i);
    assert.match(sql, /generate_series\(\s*coverage_start::timestamp/i);
    assert.match(sql, /credit\.credit_origin = 'contract'/i);
  });

  test("existing first settled tuitions are resynchronized after the fix", function () {
    assert.match(sql, /perform private\.sync_lesson_credits_for_tuition\(tuition_record\.id\)/i);
    assert.match(sql, /not exists \([\s\S]*previous_tuition\.reference_month < tuition\.reference_month/i);
  });
}
