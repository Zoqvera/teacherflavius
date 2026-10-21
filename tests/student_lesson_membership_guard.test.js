const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20261020180500_guard_lessons_before_class_membership.sql"),
  "utf8"
);

test("a newly linked student is not allocated an already-started regular lesson", () => {
  assert.match(migration, /class\.class_start_time\)\s+at time zone 'America\/Sao_Paulo'\)\s+>= membership\.created_at/);
  assert.match(migration, /membership\.first_lesson_date is not null/);
  assert.match(migration, /membership\.first_lesson_date is null[\s\S]*?lesson_day::date >= membership\.first_lesson_date/);
  assert.match(migration, /class\.first_lesson_date is null/);
});

test("historical allocations remain eligible and are never bulk-resynchronized", () => {
  assert.match(migration, /or exists\s*\([\s\S]*?from private\.lesson_credits historical_credit/);
  assert.match(migration, /historical_credit\.tuition_id = tuition_row\.id/);
  assert.match(migration, /historical_credit\.regular_starts_at/);
  assert.doesNotMatch(migration, /perform private\.sync_lesson_credits_for_tuition/);
  assert.doesNotMatch(migration, /update private\.lesson_credits/i);
});

test("guard is idempotent and fails closed when the database definition drifts", () => {
  assert.match(migration, /if position\(corrected_fragment in current_definition\) > 0/);
  assert.match(migration, /if occurrence_count <> 1 then/);
  assert.match(migration, /execute replace\(current_definition, expected_fragment, corrected_fragment\)/);
});
