const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const requiredMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260928215108_require_tuition_due_day_selection.sql"),
  "utf8"
);
const unifiedMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20261006022000_unify_first_tuition_due_rule.sql"),
  "utf8"
);
const unifiedBaseline = fs.readFileSync(
  path.join(root, "supabase", "baseline", "250_unify_first_tuition_due_rule.sql"),
  "utf8"
);
const profileScript = fs.readFileSync(path.join(root, "perfil_dos_alunos.js"), "utf8");
const dueDayScript = fs.readFileSync(path.join(root, "perfil_dos_alunos_vencimento.js"), "utf8");
const profilePage = fs.readFileSync(path.join(root, "perfil_dos_alunos.html"), "utf8");

test("configured tuition requires a due day in the database", function () {
  assert.match(
    requiredMigration,
    /alter table public\.student_billing_settings\s+alter column due_day set not null/i
  );
  assert.match(requiredMigration, /Existem mensalidades configuradas sem dia de vencimento/i);
});

test("student and administrator flows share the same two-date first-tuition rule", function () {
  for (const sql of [unifiedMigration, unifiedBaseline]) {
    assert.match(
      sql,
      /extract\(day from target_anchor_date\)::smallint[\s\S]*extract\(day from \(target_anchor_date \+ 1\)\)::smallint/i
    );
    assert.match(
      sql,
      /private\.get_enrollment_tuition_due_date_options\(enrollment_date\)/i
    );
    assert.match(
      sql,
      /Escolha o vencimento no dia da matrícula ou no dia seguinte/
    );
    assert.doesNotMatch(sql, /target_anchor_date \+ 5/i);
    assert.doesNotMatch(sql, /target_anchor_date \+ 8/i);
    assert.doesNotMatch(sql, /Escolha uma das três opções de vencimento disponíveis/i);
  }
});

test("administrator reads authoritative first-tuition options from the database", function () {
  assert.match(dueDayScript, /get_teacher_student_tuition_due_date_options/);
  assert.match(dueDayScript, /dueDayOptionsByStudentId/);
  assert.match(dueDayScript, /dia da matrícula ou no dia seguinte/);
  assert.doesNotMatch(dueDayScript, /addCalendarDays\(anchorDate, 5\)/);
  assert.doesNotMatch(dueDayScript, /addCalendarDays\(anchorDate, 8\)/);
});

test("existing configured students can keep their current recurring due day", function () {
  for (const sql of [unifiedMigration, unifiedBaseline]) {
    assert.match(
      sql,
      /if target_due_day = current_due_day[\s\S]*profile_row\.tuition_first_due_date is not null/i
    );
    assert.match(
      sql,
      /chosen_first_due_date := profile_row\.tuition_first_due_date/i
    );
  }
});

test("new administrator-selected first due date is one of the two exact enrollment dates", function () {
  for (const sql of [unifiedMigration, unifiedBaseline]) {
    assert.match(
      sql,
      /from unnest\(due_date_options\) option_date[\s\S]*extract\(day from option_date\)::integer = target_due_day/i
    );
    assert.match(sql, /tuition_first_due_date = chosen_first_due_date/i);
    assert.match(sql, /'first_due_date', chosen_first_due_date/i);
  }
});

test("billing modal still requires an explicit due-day selection", function () {
  assert.match(profilePage, /id="studentDueDay"[^>]*required/i);
  assert.match(profilePage, /Selecione o dia de vencimento/i);
  assert.match(profileScript, /Selecione um dia de vencimento\./);
  assert.match(profileScript, /target_due_day: dueDay/);
});
