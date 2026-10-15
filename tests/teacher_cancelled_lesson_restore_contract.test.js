const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261015193000_restore_cancelled_teacher_lessons.sql"),
  "utf8"
);
const teacherApp = fs.readFileSync(path.join(root, "roteiro-da-aula/app.js"), "utf8");
const workflow = fs.readFileSync(path.join(root, "academic_workflow_service.js"), "utf8");
const page = fs.readFileSync(path.join(root, "roteiro-da-aula/index.html"), "utf8");

test("cancelled students remain in the lesson plan with their academic activity", () => {
  assert.match(migration, /create or replace function public\.get_teacher_lesson_plan/i);
  assert.match(migration, /as is_cancelled/i);
  assert.match(migration, /when enriched\.is_cancelled then 'cancelled'/i);
  assert.match(migration, /when enriched\.is_cancelled and exists/i);
  assert.match(migration, /then 'cancelled_finalized'/i);
  assert.match(migration, /where enriched\.is_cancelled or not exists/i);
  assert.match(migration, /from private\.student_question_studies study/i);
  assert.match(migration, /from private\.student_lesson_preparations preparation/i);
  assert.match(migration, /booking\.status = 'confirmed'/i);
  assert.doesNotMatch(migration, /and not exists \(\s*select 1\s*from private\.student_regular_lesson_cancellations cancellation/i);
});

test("undo of cancellation is scoped to teacher and protects the replacement credit", () => {
  assert.match(migration, /create or replace function public\.restore_teacher_cancelled_regular_lesson/i);
  assert.match(migration, /public\.is_teacher_admin\(\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /matching_credit\.makeup_booking_id is not null/i);
  assert.match(migration, /matching_credit\.status = 'used'/i);
  assert.match(migration, /matching_credits > 1/i);
  assert.match(migration, /set status = 'scheduled', cancelled_at = null/i);
  assert.match(migration, /delete from private\.student_regular_lesson_cancellations/i);
  assert.match(migration, /private\.student_regular_lesson_restorations/i);
  assert.match(migration, /revoke execute on function public\.restore_teacher_cancelled_regular_lesson\(uuid, date\)\s*from public, anon/i);
  assert.match(migration, /grant execute on function public\.restore_teacher_cancelled_regular_lesson\(uuid, date\)\s*to authenticated/i);
});

test("teacher can review cancelled lessons without marking un-restored attendance", () => {
  assert.match(teacherApp, /AULAS CANCELADAS/);
  assert.match(teacherApp, /DESCANCELAR AULA/);
  assert.match(teacherApp, /CANCELADA — AULA FINALIZADA/);
  assert.match(teacherApp, /item\.attendance_status === "cancelled_finalized"/);
  assert.match(teacherApp, /isCancelled\(item\)/);
  assert.match(teacherApp, /service\.restoreCancelledRegularLesson\(item, classDate\)/);
  assert.match(workflow, /restore_teacher_cancelled_regular_lesson/);
  assert.match(migration, /plan\.attendance_status not in \('present', 'absent', 'cancelled', 'cancelled_finalized'\)/i);
  assert.match(page, /academic_workflow_service\.js\?v=20261015-cancelled-restoration-1/);
  assert.match(page, /roteiro-da-aula\/app\.js\?v=20261015-cancelled-restoration-1/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.doesNotMatch(teacherApp, /\bonline\b/i);
});
