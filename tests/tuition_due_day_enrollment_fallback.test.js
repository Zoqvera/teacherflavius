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
  "supabase/migrations/20261005144218_limit_first_tuition_to_next_day.sql"
);
const recoveryOverlay = read(
  "supabase/baseline/180_limit_first_tuition_to_next_day.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("enrollment UI requires one of exactly two first-tuition dates", function () {
  assert.match(dueDateScript, /select\.required = state\.selectedDueDate == null/);
  assert.match(dueDateScript, /state\.dateOptions\.length !== 2/);
  assert.match(dueDateScript, /Selecione uma das duas datas/);
  assert.match(
    dueDateScript,
    /Você pode escolher somente o dia da matrícula ou o dia seguinte/
  );
  assert.match(dueDateScript, /set_my_tuition_due_date/);
});

test("visible enrollment copy states the new two-date rule", function () {
  assert.match(
    page,
    /A primeira mensalidade deve vencer no dia da matrícula ou no dia seguinte/
  );
  assert.match(page, /duas únicas opções de vencimento/i);
  assert.doesNotMatch(page, /6 dias anteriores à primeira aula/i);
  assert.doesNotMatch(dueDateScript, /primeira aula/i);
});

test("database produces only enrollment date and the following date", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(
      sql,
      /private\.get_enrollment_tuition_due_date_options\(\s*target_enrollment_date date/i
    );
    assert.match(
      sql,
      /array\[\s*target_enrollment_date,\s*target_enrollment_date \+ 1\s*\]::date\[\]/i
    );
    assert.doesNotMatch(sql, /generate_series/i);
    assert.doesNotMatch(sql, /class_weekday/i);
  }
});

test("exact-date RPC rejects every date outside the two allowed options", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(
      sql,
      /chosen_first_due_date = any\(due_date_options\)/i
    );
    assert.match(
      sql,
      /Escolha o vencimento no dia da matrícula ou no dia seguinte/
    );
    assert.match(sql, /tuition_first_due_date = chosen_first_due_date/i);
  }
});

test("browser bypass still fails safe to enrollment-day payment", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(
      sql,
      /chosen_first_due_date := coalesce\(target_due_date, enrollment_date\)/i
    );
    assert.match(sql, /due_day_source :=[\s\S]*'system'/i);
  }
});

test("legacy day-based RPC maps only to the same two exact dates", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(
      sql,
      /due_date_options :=[\s\S]*get_enrollment_tuition_due_date_options\(enrollment_date\)/i
    );
    assert.match(
      sql,
      /return public\.set_my_tuition_due_date\(compatible_due_date\)/i
    );
  }
});

test("obsolete first-lesson scheduling helper is removed", function () {
  for (const sql of [migration, recoveryOverlay]) {
    assert.match(
      sql,
      /drop function if exists private\.get_enrollment_tuition_schedule\(uuid, date\)/i
    );
  }
});

test("recovery applies the two-date tuition overlay", function () {
  assert.match(workflow, /180_limit_first_tuition_to_next_day\.sql/);
});
