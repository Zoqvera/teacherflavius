const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260928215108_require_tuition_due_day_selection.sql"),
  "utf8"
);
const profileScript = fs.readFileSync(path.join(root, "perfil_dos_alunos.js"), "utf8");
const dueDayScript = fs.readFileSync(path.join(root, "perfil_dos_alunos_vencimento.js"), "utf8");
const profilePage = fs.readFileSync(path.join(root, "perfil_dos_alunos.html"), "utf8");

test("configured tuition requires a due day in the database", function () {
  assert.match(
    migration,
    /alter table public\.student_billing_settings\s+alter column due_day set not null/i
  );
  assert.match(migration, /Existem mensalidades configuradas sem dia de vencimento/i);
});

test("administrator due-day selection follows the current three-option rule", function () {
  assert.match(migration, /calculate_tuition_due_day_options\(anchor_date\)/i);
  assert.match(migration, /target_due_day::smallint = any\(due_day_options\)/i);
  assert.match(migration, /Escolha uma das três opções de vencimento disponíveis/i);
  assert.match(migration, /tuition_due_day_source = due_day_source/i);
  assert.match(migration, /else 'admin'/i);
});

test("existing operational due days remain authoritative during migration", function () {
  assert.match(migration, /tuition_due_day = s\.due_day/i);
  assert.match(migration, /p\.tuition_due_day is distinct from s\.due_day/i);
  assert.match(
    migration,
    /coalesce\(s\.due_day, p\.tuition_due_day\)::smallint/i
  );
});

test("billing modal requires an explicit due-day selection", function () {
  assert.match(profilePage, /id="studentDueDay"[^>]*required/i);
  assert.match(profilePage, /Selecione o dia de vencimento/i);
  assert.match(dueDayScript, /addCalendarDays\(anchorDate, 5\)\.day/);
  assert.match(dueDayScript, /addCalendarDays\(anchorDate, 8\)\.day/);
  assert.match(dueDayScript, /target_due_day: dueDay/);
});

test("billing save has no implicit fallback due day", function () {
  assert.match(profileScript, /Selecione um dia de vencimento\./);
  assert.match(profileScript, /target_due_day: dueDay/);
  assert.doesNotMatch(profileScript, /target_due_day:[^\n]*\?[^\n]*:\s*10/);
});
