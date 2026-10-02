const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const dueDayScript = read("student_tuition_due_day.js");
const migration = read(
  "supabase/migrations/20261002015000_auto_assign_tuition_due_seven_days_after_enrollment.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");
const recoveryOverlay = read(
  "supabase/baseline/110_auto_assign_tuition_due_seven_days_after_enrollment.sql"
);

test("student may finish enrollment without explicitly selecting a due day", function () {
  assert.match(dueDayScript, /input\.required = false/);
  assert.doesNotMatch(
    dueDayScript,
    /throw new Error\("Escolha uma das três opções de vencimento da mensalidade\."\)/
  );
  assert.match(
    dueDayScript,
    /target_due_day: Number\.isInteger\(selectedDueDay\) \? selectedDueDay : null/
  );
  assert.match(page, /7 dias após a matrícula/);
});

test("database RPC assigns seven calendar days after enrollment anchor when omitted", function () {
  assert.match(migration, /if target_due_day is null then/);
  assert.match(migration, /chosen_first_due_date := anchor_date \+ 7/);
  assert.match(
    migration,
    /effective_due_day := extract\(day from chosen_first_due_date\)::smallint/
  );
  assert.match(migration, /due_day_source := 'system'/);
  assert.match(migration, /'auto_assigned', auto_assigned/);
});

test("explicit student selection keeps the existing three-option rule", function () {
  assert.match(migration, /calculate_tuition_due_day_options\(anchor_date\)/);
  assert.match(migration, /target_due_day::smallint = any\(due_day_options\)/);
  assert.match(migration, /due_day_source := 'student'/);
});

test("profile activation also fails safe to seven days if the browser flow is bypassed", function () {
  assert.match(migration, /if new\.tuition_due_day is null then/);
  assert.match(migration, /automatic_first_due_date := anchor_date \+ 7/);
  assert.match(
    migration,
    /new\.tuition_due_day := extract\(day from automatic_first_due_date\)::smallint/
  );
  assert.match(migration, /new\.tuition_due_day_source := 'system'/);
});

test("recovery overlay provisions the tuition due-date profile columns", function () {
  assert.match(recoveryOverlay, /add column if not exists tuition_due_day smallint/);
  assert.match(recoveryOverlay, /add column if not exists tuition_due_day_anchor_date date/);
  assert.match(recoveryOverlay, /add column if not exists tuition_due_day_selected_at timestamptz/);
  assert.match(recoveryOverlay, /add column if not exists tuition_first_due_date date/);
  assert.match(recoveryOverlay, /add column if not exists tuition_due_day_source text/);
});

test("automatic due dates are valid profile sources and recovery applies the overlay", function () {
  assert.match(
    migration,
    /tuition_due_day_source in \('student', 'admin', 'legacy', 'system'\)/
  );
  assert.match(workflow, /110_auto_assign_tuition_due_seven_days_after_enrollment\.sql/);
});
