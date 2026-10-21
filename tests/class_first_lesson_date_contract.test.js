const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261017012456_20261017013000_saturday_class_start_date.sql"),
  "utf8"
);
const adminPage = fs.readFileSync(path.join(root, "turma.html"), "utf8");
const adminScript = fs.readFileSync(path.join(root, "class_start_date_admin.js"), "utf8");

test("start date is configured for both Saturday classes without editing tuition due dates", () => {
  assert.match(migration, /class_number in \(105,108\)/);
  assert.match(migration, /'2026-10-24'/);
  assert.match(migration, /update public\.class_students\s+set first_lesson_date/i);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
});

test("academic plans, student attendance, contracted credits, and automatic replacement slots honor the start date", () => {
  assert.match(migration, /public\.get_teacher_lesson_plan\(date\)/);
  assert.match(migration, /public\.get_teacher_students_of_day\(\)/);
  assert.match(migration, /private\.resolve_academic_lesson\(text,uuid,date\)/);
  assert.match(migration, /private\.sync_lesson_credits_for_tuition\(uuid\)/);
  assert.match(migration, /public\.sync_auto_makeup_slots_30_days\(\)/);
  assert.match(migration, /membership\.first_lesson_date/i);
  assert.match(migration, /class\.first_lesson_date/i);
  assert.match(migration, /tc\.first_lesson_date/i);
});

test("admin-only RPC prevents invalid start date and protects historical attendance", () => {
  assert.match(migration, /create or replace function public\.set_teacher_class_first_lesson_date/i);
  assert.match(migration, /public\.is_teacher_admin\(\)/i);
  assert.match(migration, /extract\(isodow from target_first_lesson_date\)/i);
  assert.match(migration, /private\.academic_lesson_occurrences/i);
  assert.match(migration, /revoke all on function public\.set_teacher_class_first_lesson_date/i);
});

test("teacher's class page exposes a usable class-start-date editor", () => {
  assert.match(adminPage, /id="classStartDateForm"/);
  assert.match(adminPage, /id="classStartDate"[^>]*type="date"/);
  assert.match(adminPage, /class_start_date_admin\.js\?v=/);
  assert.match(adminScript, /get_teacher_class_first_lesson_date/);
  assert.match(adminScript, /set_teacher_class_first_lesson_date/);
  assert.match(adminScript, /form\.addEventListener\("submit", handleSubmit\)/);
  assert.doesNotMatch(adminScript, /\bonline\b/i);
});
