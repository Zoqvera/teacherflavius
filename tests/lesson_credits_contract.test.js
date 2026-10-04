const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004033000_lesson_credits_and_my_lessons.sql"),
  "utf8"
);
const app = fs.readFileSync(
  path.join(ROOT, "area-do-estudante/minhas-aulas/app.js"),
  "utf8"
);
const page = fs.readFileSync(
  path.join(ROOT, "area-do-estudante/minhas-aulas/index.html"),
  "utf8"
);
const studentArea = fs.readFileSync(path.join(ROOT, "area_do_estudante.html"), "utf8");
const profilePage = fs.readFileSync(path.join(ROOT, "perfil_dos_alunos.html"), "utf8");
const profileScript = fs.readFileSync(path.join(ROOT, "perfil_dos_alunos.js"), "utf8");
const billingScript = fs.readFileSync(path.join(ROOT, "perfil_dos_alunos_vencimento.js"), "utf8");

const lessonCreditBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/140_lesson_credits_and_my_lessons.sql"),
  "utf8"
);
const lessonCreditAmbiguityFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004071132_fix_lesson_credit_number_ambiguity.sql"),
  "utf8"
);

test("settled tuition grants the configured monthly lesson quantity", function () {
  assert.match(migration, /classes_per_month smallint/i);
  assert.match(migration, /sync_lesson_credits_after_tuition_change/i);
  assert.match(migration, /payment_date is not null or coalesce\(tuition\.is_exempt, false\) = true/i);
  assert.match(migration, /generate_series\(1, contracted_count::integer\)/i);
});

test("regular lesson cancellation is enforced on the server with a 12-hour cutoff", function () {
  assert.match(migration, /create or replace function public\.cancel_my_regular_lesson/i);
  assert.match(migration, /regular_starts_at - interval '12 hours'/i);
  assert.match(migration, /private\.student_regular_lesson_cancellations/i);
  assert.match(migration, /status = 'available'/i);
});

test("replacement booking only exposes quintet occurrences with operational capacity", function () {
  assert.match(migration, /create or replace function public\.get_my_replacement_options/i);
  assert.match(migration, /class\.class_type = 'quintet'/i);
  assert.match(migration, /private\.get_class_operational_capacity/i);
  assert.match(migration, /available_spots integer/i);
  assert.match(migration, /regular_students - snapshot\.cancelled_regular_students \+ snapshot\.replacement_students/i);
});

test("a replacement consumes a real credit and legacy creditless booking is blocked", function () {
  assert.match(migration, /create or replace function public\.book_my_lesson_replacement/i);
  assert.match(migration, /credit_row\.status <> 'available'/i);
  assert.match(migration, /status = 'used'/i);
  assert.match(migration, /revoke execute on function public\.book_makeup_class\(uuid\) from public, anon, authenticated/i);
});

test("the unpaid notice uses the enrolled class names and required wording", function () {
  assert.match(app, /Você está matriculado em nosso sistema, na turma/);
  assert.match(app, /Como você ainda não pagou pelas aulas/);
  assert.match(app, /avise a Júlia no whatsapp/);
  assert.match(app, /O professor poderá passar sua vaga para outro aluno/);
  assert.match(app, /joinClassNames\(classNames\)/);
});

test("the student profile saves the contracted lesson quantity", function () {
  assert.match(profilePage, /id="studentClassesPerMonth"/);
  assert.match(profilePage, /Quantidade de aulas contratadas no mês/);
  assert.match(profileScript, /get_teacher_student_lesson_plans/);
  assert.match(billingScript, /save_student_lesson_plan/);
  assert.match(billingScript, /target_classes_per_month: classesPerMonth/);
});

test("the student area links to Minhas Aulas and the page exposes replacement controls", function () {
  assert.match(studentArea, /href="\/area-do-estudante\/minhas-aulas\/"/);
  assert.match(studentArea, />MINHAS AULAS</);
  assert.match(page, /<h1>Minhas Aulas<\/h1>/);
  assert.match(app, /Marcar reposição/);
  assert.match(app, /MARCAR REPOSIÇÃO/);
});

test("lesson credit synchronization qualifies the generated credit number", function () {
  const qualifiedSeriesPattern = /series\.credit_number::smallint as credit_number/i;
  const ambiguousDesiredCreditPattern = /desired_credits as \(\s*select\s+credit_number,/i;

  assert.match(lessonCreditBaseline, qualifiedSeriesPattern);
  assert.match(lessonCreditAmbiguityFix, qualifiedSeriesPattern);
  assert.doesNotMatch(lessonCreditBaseline, ambiguousDesiredCreditPattern);
  assert.doesNotMatch(lessonCreditAmbiguityFix, ambiguousDesiredCreditPattern);
});
