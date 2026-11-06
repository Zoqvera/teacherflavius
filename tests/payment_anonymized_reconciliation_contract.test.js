const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

const baseline = read("supabase/baseline/440_late_payment_settlement_gateway.sql");
const patch = read("scripts/sql/fix_anonymized_payment_reconciliation_20261105.sql");

test("normal settlement still validates the linked student identity", () => {
  assert.match(baseline, /tuition\.student_id = attempt_row\.student_id/);
  assert.match(baseline, /tuition\.id = attempt_row\.tuition_id/);
});

test("anonymized settlement requires both IDs null and a matching non-null subject", () => {
  for (const source of [baseline, patch]) {
    assert.match(source, /tuition\.student_id is null/);
    assert.match(source, /attempt_row\.student_id is null/);
    assert.match(source, /attempt_row\.subject_ref is not null/);
    assert.match(source, /tuition\.subject_ref = attempt_row\.subject_ref/);
  }
});

test("selective patch fails closed if the production function differs", () => {
  assert.match(patch, /occurrences <> 1/);
  assert.match(patch, /pg_get_functiondef/);
  assert.match(patch, /execute replace\(current_definition, original_predicate, corrected_predicate\)/);
});

test("payment application retains exactly-once protections", () => {
  assert.match(baseline, /and payment_date is null/);
  assert.match(baseline, /and not is_exempt;/);
  assert.match(baseline, /duplicate_payment_detected :=/);
  assert.match(baseline, /reconciliation_failure_count = 0/);
});
