const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20261020224500_first_lesson_after_membership_start.sql"),
  "utf8"
);

test("new class memberships get a São Paulo time-aware first scheduled lesson", () => {
  assert.match(migration, /before insert on public\.class_students/i);
  assert.match(migration, /at time zone 'America\/Sao_Paulo'/);
  assert.match(migration, /extract\(isodow from candidate_date\)/);
  assert.match(migration, /\)\s*<= assignment_time then/);
  assert.match(migration, /candidate_date := candidate_date \+ 7/);
});

test("the teacher's later start dates remain authoritative", () => {
  assert.match(migration, /candidate_date < class_first_date/);
  assert.match(migration, /new\.first_lesson_date := greatest\(/);
});

test("legacy rows and recorded payments are not bulk edited", () => {
  assert.match(migration, /class\.class_number = 111/);
  assert.match(migration, /membership\.first_lesson_date is null/);
  assert.match(migration, /membership\.created_at >/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
  assert.doesNotMatch(migration, /update private\.lesson_credits/i);
});
