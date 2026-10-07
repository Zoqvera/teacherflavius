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
const cancelledSeatReplacementFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261005185049_expose_cancelled_lesson_seats_for_replacement.sql"),
  "utf8"
);
const cancelledSeatReplacementBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/225_expose_cancelled_lesson_seats_for_replacement.sql"),
  "utf8"
);

const unifiedCancellationPolicy = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006024346_unify_lesson_cancellation_policy.sql"),
  "utf8"
);
const unifiedCancellationPolicyBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/230_unify_lesson_cancellation_policy.sql"),
  "utf8"
);

const cancellationSemanticsFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261007025554_separate_lesson_and_enrollment_cancellation.sql"),
  "utf8"
);
const cancellationSemanticsBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/315_separate_lesson_and_enrollment_cancellation.sql"),
  "utf8"
);

function getSqlFunctionDefinition(sql, functionName) {
  const pattern = new RegExp(
    "create or replace function public\\." + functionName + "\\([\\s\\S]*?\\$function\\$;",
    "i"
  );
  const match = sql.match(pattern);
  assert.ok(match, "Expected SQL function " + functionName + " to exist.");
  return match[0];
}

const canonicalReplacementEligibility = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006033924_canonicalize_replacement_eligibility.sql"),
  "utf8"
);
const canonicalReplacementEligibilityBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/255_canonicalize_replacement_eligibility.sql"),
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

test("the canonical cancellation policy separates cancellation eligibility from credit eligibility", function () {
  for (const sql of [unifiedCancellationPolicy, unifiedCancellationPolicyBaseline]) {
    assert.match(sql, /create or replace function private\.lesson_can_be_cancelled/i);
    assert.match(sql, /evaluated_at < target_starts_at/i);
    assert.match(sql, /create or replace function private\.lesson_cancellation_grants_credit/i);
    assert.match(sql, /evaluated_at <= target_starts_at - interval '12 hours'/i);
    assert.match(sql, /cancel_my_regular_lesson[\s\S]*private\.lesson_can_be_cancelled/i);
    assert.match(sql, /cancel_my_regular_lesson[\s\S]*private\.lesson_cancellation_grants_credit/i);
    assert.match(sql, /cancel_my_lesson_replacement[\s\S]*private\.lesson_can_be_cancelled/i);
    assert.match(sql, /cancel_my_lesson_replacement[\s\S]*private\.lesson_cancellation_grants_credit/i);
    assert.match(sql, /when credit\.status = 'scheduled'[\s\S]*private\.lesson_can_be_cancelled\(credit\.regular_starts_at, now\(\)\)/i);
    assert.match(sql, /when credit\.status = 'used'[\s\S]*private\.lesson_can_be_cancelled\(slot\.starts_at, now\(\)\)/i);
    assert.doesNotMatch(sql, /O prazo para cancelamento terminou 12 horas antes da aula/i);
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
  assert.match(app, /data-cancellation-kind="regular"/);
  assert.match(app, /data-cancellation-kind="replacement"/);
  assert.match(app, /A vaga foi liberada, sem geração de crédito/);
  assert.match(app, /o crédito usado nesta reposição não será devolvido/);
  assert.match(app, /if \(!expectsCredit\)[\s\S]*openLateCancellationModal\(button\)/);
  assert.match(app, /button\.dataset\.cancellationKind === "replacement"/);
});

test("late cancellation requires the requested popup confirmation before the RPC", function () {
  assert.match(page, /id="lateCancellationModal"/);
  assert.match(page, /O cancelamento das aulas a menos de 12 horas da aula é permitido, mas o valor da aula não será reembolsado e o aluno não vai poder repor a aula\./);
  assert.match(page, /Mas não se preocupe, você pode assistir a aula gravada, basta solicitar à Júlia no whatsapp do teacher\. A solicitação do link da aula gravada deve ser feita no dia posterior à aula\./);
  assert.match(page, /id="lateCancellationConfirm"[^>]*>CANCELAR ESTA AULA<\/button>/);
  assert.match(app, /pendingLateCancellationButton/);
  assert.match(app, /confirmLateCancellation/);
  assert.match(app, /rpc\("cancel_my_regular_lesson"/);
  assert.match(app, /rpc\("cancel_my_lesson_replacement"/);
  assert.match(app, /performLessonCancellation\(triggerButton\)/);
});

test("Minhas Aulas renders only future scheduled or replacement lesson cards", function () {
  assert.match(app, /function getUpcomingLessonCredits\(credits\)/);
  assert.match(app, /credit\.status !== "scheduled" && credit\.status !== "used"/);
  assert.match(app, /startsAt\.getTime\(\) > now/);
  assert.match(app, /Nenhuma próxima aula encontrada/);
  assert.match(app, /upcomingLessons\.map\(function \(credit\)/);
});

test("replacement booking only exposes quintet occurrences with operational capacity", function () {
  assert.match(migration, /create or replace function public\.get_my_replacement_options/i);
  assert.match(migration, /class\.class_type = 'quintet'/i);
  assert.match(migration, /private\.get_class_operational_capacity/i);
  assert.match(migration, /available_spots integer/i);
  assert.match(migration, /regular_students - snapshot\.cancelled_regular_students \+ snapshot\.replacement_students/i);
});

test("replacement vacancies require an on-time cancellation credit", function () {
  assert.match(replacementEligibilityFix, /credit\.status = 'available'/i);
  assert.match(replacementEligibilityFix, /credit\.cancelled_at is not null/i);
  assert.match(replacementEligibilityFix, /credit\.cancelled_at <= credit\.regular_starts_at - interval '12 hours'/i);
  assert.match(replacementEligibilityFix, /replacement_credit_ids/i);
  assert.match(app, /getReplacementCreditIds/);
  assert.match(app, /if \(availableCredits < 1\) return ""/);
});

test("replacement eligibility uses the canonical four-or-more-or-cancelled-seat rule", function () {
  for (const sql of [canonicalReplacementEligibility, canonicalReplacementEligibilityBaseline]) {
    assert.match(sql, /create or replace function private\.is_replacement_occurrence_eligible/i);
    assert.match(sql, /available_spots >= 4/i);
    assert.match(sql, /cancellation_spots_available >= 1/i);
    assert.match(sql, /get_my_replacement_options[\s\S]*private\.is_replacement_occurrence_eligible/i);
    assert.match(sql, /book_my_lesson_replacement[\s\S]*private\.is_replacement_occurrence_eligible/i);
    assert.match(sql, /cancellation\.lesson_date = \(occurrence\.starts_at at time zone 'America\/Sao_Paulo'\)::date/i);
    assert.match(sql, /cancellation\.lesson_date = \(target_starts_at at time zone 'America\/Sao_Paulo'\)::date/i);
    assert.match(sql, /select class\.\*[\s\S]*for update/i);
    assert.match(sql, /available_spots <= 0/i);
    assert.doesNotMatch(sql, /available_spots <> 4/i);
  }
  assert.doesNotMatch(app, /vaga liberada por cancelamento ou uma turma com 4 vagas disponíveis/);
  assert.doesNotMatch(app, /Cada aula do mês aparece em um card/);
  assert.match(app, /Nenhuma vaga de reposição disponível foi encontrada/);
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

test("the unpaid notice distinguishes enrollment cancellation from lesson cancellation", function () {
  assert.match(app, /Você está matriculado em nosso sistema, na turma/);
  assert.match(app, /Como você ainda não fez o primeiro pagamento/);
  assert.match(app, /Use CANCELAR MINHA MATRÍCULA somente se quiser sair da turma/);
  assert.match(app, /ela não cancela apenas uma aula/i);
  assert.match(app, /avise a Júlia no whatsapp/);
  assert.match(app, /joinClassNames\(classNames\)/);
});

test("Minhas Aulas uses distinct actions for an occurrence and for enrollment", function () {
  assert.match(app, />CANCELAR ESTA AULA<\/button>/);
  assert.match(app, />CANCELAR MINHA MATRÍCULA<\/button>/);
  assert.match(app, /cancel_my_unpaid_enrollment/);
  assert.doesNotMatch(app, /cancel_my_unpaid_class/);
  assert.match(app, /Esta ação não cancela apenas uma aula/);
});

test("only the enrollment-cancellation RPC removes the unpaid student's class membership", function () {
  for (const sql of [cancellationSemanticsFix, cancellationSemanticsBaseline]) {
    assert.match(sql, /create or replace function public\.cancel_my_unpaid_enrollment\(target_class_number integer\)/i);
    assert.match(sql, /delete from public\.class_students membership/i);
    assert.match(sql, /drop function if exists public\.cancel_my_unpaid_class\(integer\)/i);
    assert.match(sql, /grant execute on function public\.cancel_my_unpaid_enrollment\(integer\) to authenticated, service_role/i);
  }

  for (const sql of [unifiedCancellationPolicy, unifiedCancellationPolicyBaseline]) {
    const regularCancellation = getSqlFunctionDefinition(sql, "cancel_my_regular_lesson");
    assert.doesNotMatch(regularCancellation, /delete\s+from\s+public\.class_students/i);
  }
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
