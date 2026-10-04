const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const dueDateScript = read("student_tuition_due_day.js");
const migration = read(
  "supabase/migrations/20261004194636_set_first_tuition_before_first_lesson.sql"
);
const recoveryOverlay = read(
  "supabase/baseline/175_set_first_tuition_before_first_lesson.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("enrollment UI requires an exact first-tuition due date", function () {
  assert.match(dueDateScript, /id = "tuitionDueDate"/);
  assert.match(dueDateScript, /select\.required = state\.selectedDueDate == null/);
  assert.match(dueDateScript, /Escolha a data de vencimento da primeira mensalidade/);
  assert.match(dueDateScript, /set_my_tuition_due_date/);
  assert.match(dueDateScript, /target_due_date: selectedDueDate/);
  assert.doesNotMatch(dueDateScript, /set_my_tuition_due_day",/);
});

test("UI explains the six-day deadline and removes the old seven-day copy", function () {
  assert.match(page, /até o limite de 6 dias antes da primeira aula/i);
  assert.doesNotMatch(page, /7 dias após a matrícula/i);
  assert.match(dueDateScript, /O último vencimento possível é 6 dias antes da primeira aula/);
});

test("database builds every valid date from enrollment through first lesson minus six days", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(sql, /private\.get_enrollment_tuition_schedule/i);
    assert.match(sql, /first_lesson\.first_lesson_date - 6/i);
    assert.match(sql, /generate_series\(/i);
    assert.match(sql, /target_enrollment_date::timestamp/i);
    assert.match(sql, /bounds\.latest_due_date::timestamp/i);
  }
});

test("first lesson within six days or missing schedule falls back to enrollment day only", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(sql, /when first_lesson\.first_lesson_date is null then target_enrollment_date/i);
    assert.match(
      sql,
      /when first_lesson\.first_lesson_date - 6 <= target_enrollment_date[\s\S]*then target_enrollment_date/i
    );
  }
});

test("exact selected due date must belong to the calculated window", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(sql, /create or replace function public\.set_my_tuition_due_date\(target_due_date date\)/i);
    assert.match(sql, /chosen_first_due_date = any\(schedule_row\.due_date_options\)/i);
    assert.match(sql, /tuition_first_due_date = chosen_first_due_date/i);
    assert.match(sql, /tuition_due_day_source = due_day_source/i);
  }
});

test("browser bypass fails safe to enrollment-day payment instead of plus seven", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(sql, /automatic_first_due_date := anchor_date/i);
    assert.doesNotMatch(sql, /automatic_first_due_date := anchor_date \+ 7/i);
    assert.match(sql, /first_due_date := coalesce\([\s\S]*profile_row\.tuition_first_due_date,[\s\S]*anchor_date/i);
  }
});

test("legacy day-based RPC remains compatible but delegates to exact-date validation", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(sql, /create or replace function public\.set_my_tuition_due_day\(target_due_day integer\)/i);
    assert.match(sql, /return public\.set_my_tuition_due_date\(compatible_due_date\)/i);
  }
});

test("recovery applies the new tuition scheduling overlay", function () {
  assert.match(workflow, /175_set_first_tuition_before_first_lesson\.sql/);
});
