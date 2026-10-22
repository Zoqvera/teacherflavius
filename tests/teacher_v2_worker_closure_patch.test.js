const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");

test("v2 auto-closure patch removes ambiguous date variables without editing history", () => {
  const original = fs.readFileSync(path.join(
    ROOT, "supabase/migrations/20261022212500_academic_v2_auto_attendance_and_closure.sql"
  ), "utf8");
  const fixed = fs.readFileSync(path.join(
    ROOT, "supabase/migrations/20261022234500_fix_teacher_v2_closure_day_alias.sql"
  ), "utf8");
  assert.match(original, /for lesson_date in/);
  assert.match(fixed, /for session_day in/);
  assert.match(fixed, /cancellation\.lesson_date = session_day/);
  assert.match(fixed, /extract\(isodow from session_day\)/);
  assert.match(fixed, /create or replace function private\.run_teacher_v2_auto_finalizations\(\)/);
  assert.doesNotMatch(fixed, /\bfor lesson_date in\b/);
  assert.doesNotMatch(fixed, /\bwhere [^\n]*lesson_date = lesson_date/);
  assert.doesNotMatch(fixed, /update private\.academic_v2_automation_control/i);
  assert.doesNotMatch(fixed, /delete from public\.student_frequency/i);
});

test("disposable rehearsal executes the corrective migration before fixture", () => {
  const workflow = fs.readFileSync(path.join(
    ROOT, ".github/workflows/validate-supabase-baseline.yml"
  ), "utf8");
  const idxFix = workflow.indexOf("cat supabase/migrations/20261022234500_fix_teacher_v2_closure_day_alias.sql");
  const idxTest = workflow.indexOf("cat tests/sql/teacher_v2_disposable_rehearsal.sql");
  assert.ok(idxFix >= 0);
  assert.ok(idxTest > idxFix);
});
