const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const capacityMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260910132830_centralize_class_capacity_rules.sql"),
  "utf8"
);
const healthMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260910132938_add_operational_data_quality_health.sql"),
  "utf8"
);
const dashboard = fs.readFileSync(path.join(root, "system_health_dashboard.js"), "utf8");
const notifier = fs.readFileSync(
  path.join(root, "supabase/functions/notify-system-health-alert/index.ts"),
  "utf8"
);

test("centralizes operational class capacity", function () {
  assert.match(capacityMigration, /private\.get_class_operational_capacity/);
  assert.match(capacityMigration, /class_number in \(73, 75\)/);
  assert.doesNotMatch(capacityMigration, /class_number in \(48,\s*73\)/);
  assert.match(capacityMigration, /when tc\.class_type = 'individual' then 1/);
  assert.match(capacityMigration, /when tc\.class_type = 'quartet' then 4/);
  assert.match(capacityMigration, /when tc\.class_type = 'eight_students' then 8/);
});

test("promotes class subject reference to a database invariant", function () {
  assert.match(capacityMigration, /class_students_subject_ref_check/);
  assert.match(capacityMigration, /user_id is not null and invite_id is null/);
  assert.match(capacityMigration, /user_id is null and invite_id is not null/);
  assert.match(capacityMigration, /validate constraint class_students_subject_ref_check/);
});

test("uses centralized capacity in every write and vacancy path", function () {
  for (const functionName of [
    "enforce_class_students_capacity",
    "get_available_group_classes_for_students",
    "get_group_classes_with_available_spots__mfa_inner",
    "switch_my_group_class",
    "unarchive_teacher_student__mfa_inner"
  ]) {
    assert.match(capacityMigration, new RegExp(`function public\\.${functionName}`));
  }

  const uses = capacityMigration.match(/private\.get_class_operational_capacity/g) || [];
  assert.ok(uses.length >= 6);
});

test("data quality scanner covers core school invariants", function () {
  for (const marker of [
    "orphan_class_assignments",
    "invalid_class_student_refs",
    "class_capacity_exceeded",
    "student_class_type_mismatch",
    "duplicate_active_cpf",
    "archive_state_mismatch",
    "makeup_capacity_exceeded",
    "makeup_booking_class_mismatch",
    "lesson_orphan_class",
    "frequency_invalid_subject_ref",
    "tuition_subject_mismatch",
    "payment_attempt_subject_mismatch"
  ]) {
    assert.match(healthMigration, new RegExp(marker));
  }
});

test("historical or potentially intentional data is informational only", function () {
  assert.match(healthMigration, /archived_class_memberships_info/);
  assert.match(healthMigration, /active_billing_archived_students_info/);
  assert.match(healthMigration, /multiple_lesson_sessions_info/);
  assert.doesNotMatch(healthMigration, /data_quality_archived_class_memberships/);
  assert.doesNotMatch(healthMigration, /data_quality_multiple_lesson_sessions/);
});

test("data quality health is private, scheduled and watched", function () {
  assert.match(healthMigration, /private\.operational_data_quality_runs/);
  assert.match(healthMigration, /revoke all on table private\.operational_data_quality_runs from public, anon, authenticated/);
  assert.match(healthMigration, /operational-data-quality-health-check/);
  assert.match(healthMigration, /12,42 \* \* \* \*/);
  assert.match(healthMigration, /data_quality_check_stalled/);
  assert.match(healthMigration, /interval '90 minutes'/);
});

test("dashboard and notifier expose data quality without changing availability health", function () {
  assert.match(healthMigration, /'data_quality',latest_data_quality/);
  assert.match(dashboard, /dataQuality: normalizeHealthBlock\(dashboard\.data_quality\)/);
  assert.match(dashboard, /dataQualitySummary/);
  assert.match(dashboard, /dataQualityIssues/);
  assert.match(notifier, /data_quality_student_class_type_mismatch/);
  assert.match(notifier, /data_quality_check_stalled/);
});
