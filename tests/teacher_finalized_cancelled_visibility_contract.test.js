const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const legacyFunction = fs.readFileSync(
  path.join(root, "supabase/migrations/20261015192553_restore_cancelled_teacher_lessons.sql"),
  "utf8"
);
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261021221000_hide_cancelled_students_after_class_finalization.sql"),
  "utf8"
);

function migrationFragment(name) {
  const match = migration.match(new RegExp(name + " constant text := '([^']+)'"));
  assert.ok(match, `Missing SQL migration fragment: ${name}`);
  return match[1];
}

test("finalized class sessions remove cancelled and attended students alike", () => {
  const legacyFilter = migrationFragment("legacy_filter");
  const finalizedFilter = migrationFragment("finalized_filter");
  assert.equal(legacyFilter, "where enriched.is_cancelled or not exists (");
  assert.equal(finalizedFilter, "where not exists (");
  assert.equal(legacyFunction.split(legacyFilter).length - 1, 1);

  const updatedDefinition = legacyFunction.replace(legacyFilter, finalizedFilter);
  assert.doesNotMatch(updatedDefinition, /where enriched\.is_cancelled or not exists \(/);
  assert.match(
    updatedDefinition,
    /from enriched\s+where not exists \(\s*select 1\s+from private\.academic_class_session_finalizations finalization/i
  );
  assert.match(updatedDefinition, /finalization\.class_number = enriched\.class_number/i);
  assert.match(updatedDefinition, /finalization\.starts_at = enriched\.starts_at/i);
});

test("cancelled lessons stay visible and reversible until the class is finalized", () => {
  assert.match(legacyFunction, /when enriched\.is_cancelled then 'cancelled'/i);
  assert.match(legacyFunction, /public\.restore_teacher_cancelled_regular_lesson/i);
  assert.match(migration, /pg_get_functiondef\(to_regprocedure\('public\.get_teacher_lesson_plan\(date\)'\)\)/i);
  assert.match(migration, /execute replace\(definition, legacy_filter, finalized_filter\)/i);
  assert.match(migration, /matching_count <> 1/i);
  assert.doesNotMatch(migration, /delete from private\.student_regular_lesson_cancellations/i);
});
