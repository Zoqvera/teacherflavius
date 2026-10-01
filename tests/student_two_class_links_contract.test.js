const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260928015739_allow_student_two_class_links.sql"),
  "utf8"
);
const profileScript = fs.readFileSync(path.join(root, "perfil_dos_alunos.js"), "utf8");
const profilePage = fs.readFileSync(path.join(root, "perfil_dos_alunos.html"), "utf8");
const switchMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260928020716_protect_multi_class_self_service_switch.sql"),
  "utf8"
);
const studentClassScript = fs.readFileSync(path.join(root, "minha_turma.js"), "utf8");
const restoreOverlay = fs.readFileSync(
  path.join(root, "supabase", "baseline", "65_allow_student_two_class_links.sql"),
  "utf8"
);
const restoreWorkflow = fs.readFileSync(
  path.join(root, ".github", "workflows", "validate-supabase-baseline.yml"),
  "utf8"
);

test("database permits at most two class links per student", function () {
  assert.match(migration, /drop index if exists public\.class_students_one_class_per_user_idx/i);
  assert.match(migration, /drop index if exists public\.class_students_one_class_per_invite_idx/i);
  assert.match(migration, /create or replace function public\.enforce_class_students_max_two_classes\(\)/i);
  assert.match(migration, /if assignment_count >= 2 then/i);
  assert.match(migration, /enforce_class_students_max_two_classes_trigger/i);
  assert.match(migration, /'assignment_limit', 2/i);
});

test("new class assignment preserves existing compatible links", function () {
  const addFunctionStart = migration.indexOf(
    "create or replace function public.add_teacher_class_student_by_ref__mfa_inner"
  );
  const inviteMigrationStart = migration.indexOf(
    "create or replace function public.migrate_invite_records_to_user"
  );
  assert.ok(addFunctionStart >= 0);
  assert.ok(inviteMigrationStart > addFunctionStart);

  const addFunction = migration.slice(addFunctionStart, inviteMigrationStart);
  assert.doesNotMatch(addFunction, /delete from public\.class_students/i);
  assert.match(addFunction, /student_type_internal <> class_type_value/i);
  assert.match(addFunction, /on conflict \(class_number, user_id\) do update/i);
});

test("invite conversion preserves the two-class invariant", function () {
  assert.match(migration, /if distinct_class_count > 2 then/i);
  assert.match(
    migration,
    /A conclusão da matrícula deixaria o aluno vinculado a mais de 2 turmas\./
  );
});

test("student profile UI exposes a second class assignment", function () {
  assert.match(profileScript, /const MAX_STUDENT_CLASS_ASSIGNMENTS = 2;/);
  assert.match(profileScript, /getAssignedClassEntries/);
  assert.match(profileScript, /Turmas atuais/);
  assert.match(profileScript, /ADICIONAR TURMA/);
  assert.match(profilePage, /id="classAssignmentCurrentClasses"/);
  assert.match(profilePage, /Cada aluno pode estar vinculado a até duas turmas\./);
  assert.match(profilePage, /perfil_dos_alunos\.js\?v=20261001-immediate-payment-1/);
});

test("student class page continues to render every assigned class", function () {
  assert.match(studentClassScript, /rows\.map\(renderClassCard\)\.join\(""\)/);
});

test("self-service switching cannot erase two active class links", function () {
  assert.match(switchMigration, /if current_class_count > 1 then/i);
  assert.match(
    switchMigration,
    /A troca deve ser feita pelo professor para preservar os dois vínculos\./
  );
  assert.match(
    switchMigration,
    /where user_id = caller_id\s+and class_number = old_class_number;/i
  );
});

test("disaster recovery baseline preserves the two-class model", function () {
  assert.match(restoreOverlay, /drop index if exists public\.class_students_one_class_per_user_idx/i);
  assert.match(restoreOverlay, /enforce_class_students_max_two_classes_trigger/i);
  assert.match(restoreOverlay, /add_teacher_class_student_by_ref__mfa_inner/i);
  assert.match(restoreOverlay, /if current_class_count > 1 then/i);
  assert.match(
    restoreOverlay,
    /revoke all on function public\.add_teacher_class_student_by_ref__mfa_inner\(integer, text, text\)/
  );
  assert.match(restoreWorkflow, /supabase\/baseline\/65_allow_student_two_class_links\.sql/);
});
