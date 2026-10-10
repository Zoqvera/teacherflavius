const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261010020556_backfill_and_guard_first_tuition_due_date.sql");
const baseline = read("supabase/baseline/365_guard_first_tuition_due_date.sql");

test("legacy billing metadata is reconstructed without editing settled tuition", () => {
  assert.match(migration, /tuition_first_due_date = tuition\.due_date/);
  assert.match(migration, /tuition_due_day_source = 'legacy'/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
});

test("deferred, cross-table guard prevents active enrolled billing without first due date", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /create constraint trigger active_billing_first_due_profile_integrity[\s\S]*deferrable initially deferred/);
    assert.match(sql, /create constraint trigger active_billing_first_due_settings_integrity[\s\S]*deferrable initially deferred/);
    assert.match(sql, /billing\.active = true[\s\S]*profile\.tuition_first_due_date is null/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /revoke all on function private\.assert_active_billing_has_first_due_date/);
  }
});

test("data quality monitor includes missing first due dates as a warning", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /'data_quality_active_billing_missing_first_due'/);
    assert.match(sql, /'active_billing_missing_first_due',active_billing_missing_first_due/);
  }
});

test("financial corrections use explicit auditable event types", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /'historical_due_date_corrected'/);
    assert.match(sql, /'billing_start_month_corrected'/);
  }
});
