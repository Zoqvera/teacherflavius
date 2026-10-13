const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migrationPath = "supabase/migrations/20261013113046_allow_manual_replacement_credits_for_all_students.sql";
const overlayPath = "supabase/baseline/377_manual_replacement_credits_all_students.sql";
const migration = read(migrationPath);
const overlay = read(overlayPath);

test("reconstructs missing student modality dependency before the manual credit functions", () => {
  const helper = overlay.indexOf("create or replace function private.student_replacement_target_type");
  const eligibility = overlay.indexOf("create or replace function private.is_student_replacement_credit_eligible");
  const grant = overlay.indexOf("create or replace function public.grant_teacher_lesson_credit");
  assert.ok(helper >= 0 && helper < eligibility);
  assert.ok(eligibility < grant);
  assert.match(overlay, /when 'INDIVIDUAL' then 'individual'/);
  assert.match(overlay, /when 'QUINTETO' then 'quintet'/);
  assert.match(overlay, /regular_class\.class_type = 'individual'/);
  assert.match(overlay, /revoke all on function private\.student_replacement_target_type\(uuid\)/);
  assert.ok(overlay.includes(migration.trim()));
});

test("teacher-only manual credit grant preserves MFA and targets active students", () => {
  assert.match(migration, /public\.grant_teacher_lesson_credit\(/);
  assert.match(migration, /public\.is_teacher_admin_mfa\(\)/);
  assert.match(migration, /coalesce\(profile\.enrolled, false\) = true/);
  assert.match(migration, /coalesce\(profile\.archived, false\) = false/);
  assert.match(migration, /private\.student_replacement_target_type\(target_student_id\) is null/);
  assert.match(migration, /'manual_grant'/);
  assert.doesNotMatch(migration, /delete from public\.monthly_tuition/i);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
});

test("manual credit booking remains compatible with unpaid tuition and modality restrictions", () => {
  assert.match(migration, /credit\.credit_origin = 'manual_grant'\s+or tuition\.payment_date is not null/);
  assert.match(migration, /private\.is_student_replacement_credit_eligible/);
  assert.match(migration, /class\.class_type = private\.student_replacement_target_type\(caller_id\)/);
  assert.match(migration, /private\.is_replacement_weekday_eligible/);
  assert.match(migration, /tuition\.payment_date is not null/);
});

test("restore and migration reconciliation retain exact applied version", () => {
  const workflow = read(".github/workflows/validate-supabase-baseline.yml");
  const ledger = read("supabase/baseline/migration-ledger.csv");
  const fingerprint = JSON.parse(read("supabase/baseline/schema-fingerprint.json"));
  assert.match(workflow, /377_manual_replacement_credits_all_students\.sql/);
  assert.match(ledger, /20261013113046,allow_manual_replacement_credits_for_all_students/);
  assert.equal(fingerprint.captured_from_migration_version, "20261013113046");
  assert.equal(fingerprint.public_functions, 188);
  assert.equal(fingerprint.private_functions, 35);
});
