const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const invariantMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261007030810_enforce_archived_student_billing_invariant.sql"),
  "utf8"
);
const generatorMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261005150117_allow_enrollment_day_first_tuition.sql"),
  "utf8"
);
const unarchiveMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260917012311_preserve_exercise_progress_on_unarchive.sql"),
  "utf8"
);
const dataQualityMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260910132938_add_operational_data_quality_health.sql"),
  "utf8"
);

test("archiving a student deactivates billing in the same database workflow", function () {
  assert.match(invariantMigration, /private\.apply_archived_student_invariants/);
  assert.match(invariantMigration, /delete from public\.class_students/);
  assert.match(invariantMigration, /update public\.student_billing_settings/);
  assert.match(invariantMigration, /set active = false/);
  assert.match(invariantMigration, /after update of archived on public\.profiles/);
});

test("archived students cannot have billing reactivated", function () {
  assert.match(invariantMigration, /private\.prevent_archived_student_billing_activation/);
  assert.match(
    invariantMigration,
    /before insert or update of student_id, active on public\.student_billing_settings/
  );
  assert.match(invariantMigration, /new\.active is true/);
  assert.match(invariantMigration, /coalesce\(profile\.archived, false\) = true/);
  assert.match(invariantMigration, /errcode = '23514'/);
});

test("reactivation stays financially explicit and tuition generation keeps defense in depth", function () {
  assert.doesNotMatch(unarchiveMigration, /student_billing_settings/);
  assert.match(generatorMigration, /where s\.active = true/);
  assert.match(generatorMigration, /coalesce\(p\.archived, false\) = false/);
});

test("data quality monitoring keeps archived billing visible as a zero-count assertion", function () {
  assert.match(dataQualityMigration, /active_billing_archived_students/);
  assert.match(dataQualityMigration, /active_billing_archived_students_info/);
});
