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

const lessonCancellationFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004083150_sync_lesson_cards_and_late_cancellation.sql"),
  "utf8"
);
const lessonCancellationBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/155_sync_lesson_cards_and_late_cancellation.sql"),
  "utf8"
);
const priorPayerNoticeFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261005172627_hide_unpaid_notice_for_prior_payers.sql"),
  "utf8"
);
const replacementEligibilityFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261005174949_restrict_replacement_options_to_eligible_credits.sql"),
  "utf8"
);

const billingCycleFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261005183000_align_lesson_cards_with_billing_cycle.sql"),
  "utf8"
);
const billingCycleBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/220_align_lesson_cards_with_billing_cycle.sql"),
  "utf8"
);

test("settled tuition grants the configured monthly lesson quantity", function () {
  assert.match(migration, /classes_per_month smallint/i);
  assert.match(migration, /sync_lesson_credits_after_tuition_change/i);
  assert.match(migration, /payment_date is not null or coalesce\(tuition\.is_exempt, false\) = true/i);
  assert.match(migration, /generate_series\(1, contracted_count::integer\)/i);
});

test("regular cancellation always releases the occurrence before start and grants credit only with 12 hours", function () {
  for (const sql of [lessonCancellationFix, lessonCancellationBaseline]) {
    assert.match(sql, /if now\(\) >= credit_row\.regular_starts_at/i);
    assert.match(sql, /student_regular_lesson_cancellations/i);
    assert.match(sql, /credit_granted := now\(\) <= credit_row\.regular_starts_at - interval '12 hours'/i);
    assert.match(sql, /'available' else 'forfeited'/i);
    assert.match(sql, /when credit\.status = 'scheduled'[\s\S]*now\(\) < credit\.regular_starts_at/i);
  }
});

test("lesson-plan changes resynchronize already-settled tuition", function () {
  for (const sql of [lessonCancellationFix, lessonCancellationBaseline]) {
    assert.match(sql, /sync_lesson_credits_after_plan_change/i);
    assert.match(sql, /after insert or update of classes_per_month/i);
    assert.match(sql, /perform private\.sync_lesson_credits_for_tuition\(tuition_record\.id\)/i);
  }
});

test("Minhas Aulas explains late cancellation without credit and keeps the cancel action available", function () {
  assert.match(app, /CANCELADA SEM CRÉDITO/);
  assert.match(app, /Você ainda pode cancelar e liberar a vaga/);
  assert.match(app, /data-credit-eligible/);
  assert.match(app, /A vaga foi liberada, sem geração de crédito/);
});

test("replacement booking only exposes quintet occurrences with operational capacity", function () {
  assert.match(migration, /create or replace function public\.get_my_replacement_options/i);
  assert.match(migration, /class\.class_type = 'quintet'/i);
  assert.match(migration, /private\.get_class_operational_capacity/i);
  assert.match(migration, /available_spots integer/i);
  assert.match(migration, /regular_students - snapshot\.cancelled_regular_students \+ snapshot\.replacement_students/i);
});

test("replacement vacancies require an on-time cancellation credit and exactly four open spots", function () {
  assert.match(replacementEligibilityFix, /credit\.status = 'available'/i);
  assert.match(replacementEligibilityFix, /credit\.cancelled_at is not null/i);
  assert.match(replacementEligibilityFix, /credit\.cancelled_at <= credit\.regular_starts_at - interval '12 hours'/i);
  assert.match(replacementEligibilityFix, /= 4\s*order by snapshot\.starts_at/i);
  assert.match(replacementEligibilityFix, /if available_spots <> 4 then/i);
  assert.match(replacementEligibilityFix, /replacement_credit_ids/i);
  assert.match(app, /getReplacementCreditIds/);
  assert.match(app, /if \(availableCredits < 1\) return ""/);
  assert.match(app, /turma com 4 vagas disponíveis/);
});

test("paid lesson cards follow the tuition due-date billing cycle", function () {
  for (const sql of [billingCycleFix, billingCycleBaseline]) {
    assert.match(sql, /create or replace function private\.get_tuition_coverage_end/i);
    assert.match(sql, /create or replace function private\.get_active_settled_tuition_id/i);
    assert.match(sql, /tuition\.due_date <= target_date/i);
    assert.match(sql, /target_date < private\.get_tuition_coverage_end\(tuition\.id\)/i);
    assert.match(sql, /tuition_row\.due_date::timestamp/i);
    assert.match(sql, /\(coverage_end - 1\)::timestamp/i);
    assert.match(sql, /credit\.tuition_id = active_tuition_id/i);
    assert.doesNotMatch(sql, /generate_series\(\s*tuition_row\.reference_month::timestamp/i);
  }
});

test("billing-cycle resynchronization preserves cancelled and replacement lesson history", function () {
  for (const sql of [billingCycleFix, billingCycleBaseline]) {
    assert.match(sql, /private\.lesson_credits\.cancelled_at is null/i);
    assert.match(sql, /private\.lesson_credits\.makeup_booking_id is null/i);
    assert.match(sql, /private\.lesson_credits\.status in \('scheduled', 'available'\)/i);
    assert.match(sql, /perform private\.sync_lesson_credits_for_tuition\(tuition_record\.id\)/i);
  }
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

test("the first-payment warning is hidden after any settled tuition", function () {
  assert.match(priorPayerNoticeFix, /'has_paid_before', has_paid_before/i);
  assert.match(priorPayerNoticeFix, /payment_date is not null or coalesce\(tuition\.is_exempt, false\) = true/i);
  assert.match(app, /const firstPaymentPending = overview\.has_paid_before !== true/);
  assert.match(app, /renderClassCards\(classes, firstPaymentPending && classes\.length > 0\)/);
  assert.match(priorPayerNoticeFix, /Esta ação é exclusiva para alunos que ainda não fizeram o primeiro pagamento/);
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
