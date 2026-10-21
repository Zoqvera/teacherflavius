const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (relativePath) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

const progressionMigration = read(
  "supabase/migrations/20261021142500_advance_lesson_only_after_teacher_presentation.sql"
);
const academicWorkflow = read(
  "supabase/migrations/20261004080244_add_academic_lesson_workflow.sql"
);
const actionPlan = read(
  "supabase/migrations/20261014201405_expose_study_button_marker.sql"
);
const teacherPlan = read(
  "supabase/migrations/20261015192553_restore_cancelled_teacher_lessons.sql"
);

test("only teacher-confirmed lesson occurrences advance the next lesson", () => {
  assert.match(progressionMigration, /create or replace function private\.academic_next_lesson_number\(target_student_id uuid\)/i);
  assert.match(progressionMigration, /from private\.academic_lesson_occurrences occurrence/i);
  assert.match(progressionMigration, /occurrence\.student_id = target_student_id/i);
  assert.match(progressionMigration, /occurrence\.attendance_status = 'present'/i);
  assert.match(progressionMigration, /max\(occurrence\.presented_lesson_number\)/i);
  assert.match(progressionMigration, /occurrence\.presented_lesson_number between 1 and 74/i);
  assert.doesNotMatch(progressionMigration, /from public\.class_lesson_records/i);
  assert.doesNotMatch(progressionMigration, /from public\.study_roadmap_completion/i);
});

test("new students start with lesson 1 and the final lesson ends progression", () => {
  assert.match(progressionMigration, /when progress\.last_presented_lesson is null then 1/i);
  assert.match(progressionMigration, /when progress\.last_presented_lesson >= 74 then null/i);
  assert.match(progressionMigration, /else progress\.last_presented_lesson \+ 1/i);
});

test("teacher confirmation writes the authoritative presentation record", () => {
  assert.match(academicWorkflow, /create or replace function public\.mark_teacher_lesson_presented/i);
  assert.match(academicWorkflow, /update private\.academic_lesson_occurrences occurrence[\s\S]*?presented_lesson_number = target_lesson_number/i);
  assert.match(actionPlan, /next_lesson := private\.academic_next_lesson_number\(caller_id\)/i);
  assert.match(teacherPlan, /private\.academic_next_lesson_number\(scheduled\.student_id\)/i);
});

test("progression migration preserves historical records and private RPC access", () => {
  assert.doesNotMatch(progressionMigration, /^\s*(?:delete|update|truncate|drop)\b/gim);
  assert.match(progressionMigration, /revoke execute on function private\.academic_next_lesson_number\(uuid\)[\s\S]*?from public, anon, authenticated/i);
  assert.match(progressionMigration, /grant execute on function private\.academic_next_lesson_number\(uuid\)[\s\S]*?to service_role/i);
});
