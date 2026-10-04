const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "complete-cadastro.html"), "utf8");
const historicalMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004074423_student_sets_enrollment_commercial_terms.sql"),
  "utf8"
);
const historicalBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/145_student_sets_enrollment_commercial_terms.sql"),
  "utf8"
);
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004141941_derive_enrollment_lessons_from_fee.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/165_derive_enrollment_lessons_from_fee.sql"),
  "utf8"
);
const notifier = fs.readFileSync(
  path.join(ROOT, "supabase/functions/notify-new-enrollment/index.ts"),
  "utf8"
);
const paymentAvailability = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/95_unlock_next_tuition_two_days_after_payment.sql"),
  "utf8"
);

test("new enrollment form asks only for one of the supported monthly fees", function () {
  assert.doesNotMatch(page, /id="classesPerMonth"/);
  assert.doesNotMatch(page, /Quantidade de aulas por mês/);
  assert.match(page, /<select id="monthlyFee" required>/);
  assert.match(page, /<option value="50">R\$ 50,00<\/option>/);
  assert.match(page, /<option value="99\.90">R\$ 99,90<\/option>/);
  assert.match(page, /<option value="100">R\$ 100,00<\/option>/);
  assert.match(page, /<option value="250">R\$ 250,00<\/option>/);
  assert.match(page, /quantidade de aulas mensais será definida automaticamente/i);
});

test("enrollment saves due-day choice before commercial terms and profile activation", function () {
  const dueDayIndex = page.indexOf("StudentTuitionDueDay.saveSelection");
  const billingIndex = page.indexOf("set_my_enrollment_billing_terms");
  const profileIndex = page.indexOf("Auth.completeProfile");

  assert.ok(dueDayIndex >= 0);
  assert.ok(billingIndex > dueDayIndex);
  assert.ok(profileIndex > billingIndex);
  assert.doesNotMatch(page, /target_classes_per_month/);
  assert.match(page, /target_monthly_fee: monthlyFee/);
});

test("database derives lesson quantity from the selected enrollment fee", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /private\.enrollment_classes_per_month_for_fee/);
    assert.match(sql, /when 50\.00 then 4::smallint/);
    assert.match(sql, /when 100\.00 then 8::smallint/);
    assert.match(sql, /when 99\.90 then 4::smallint/);
    assert.match(sql, /when 250\.00 then 4::smallint/);
    assert.match(
      sql,
      /create or replace function public\.set_my_enrollment_billing_terms\(\s*target_monthly_fee numeric/i
    );
    assert.doesNotMatch(sql, /target_classes_per_month integer/);
    assert.match(sql, /derived_classes_per_month/);
    assert.match(sql, /classes_per_month = excluded\.classes_per_month/i);
  }
});

test("enrollment billing RPC remains restricted to pre-enrollment authorized students", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /coalesce\(profile_row\.enrolled, false\)/i);
    assert.match(sql, /coalesce\(profile_row\.profile_completed, false\)/i);
    assert.match(sql, /from private\.student_enrollment_access access/i);
    assert.match(sql, /Escolha um valor de mensalidade válido/i);
  }
});

test("profile activation revalidates the fee-to-lessons mapping", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /select settings\.monthly_fee, settings\.classes_per_month/i);
    assert.match(sql, /expected_classes_per_month/);
    assert.match(sql, /billing_classes_per_month is distinct from expected_classes_per_month/i);
    assert.match(sql, /Escolha um valor de mensalidade válido antes de concluir a matrícula/i);
  }
});

test("existing enrollment activation still generates the first tuition after enrollment", function () {
  for (const sql of [historicalMigration, historicalBaseline]) {
    assert.match(sql, /private\.ensure_first_tuition_after_profile_enrollment/i);
    assert.match(sql, /after update of enrolled on public\.profiles/i);
    assert.match(sql, /private\.ensure_first_tuition_for_student/i);
  }
});

test("new enrollment email contains derived lesson quantity and agreed monthly fee", function () {
  assert.match(notifier, /\.from\("student_billing_settings"\)/);
  assert.match(notifier, /\.select\("monthly_fee, classes_per_month"\)/);
  assert.match(notifier, /Quantidade de aulas por mês:/);
  assert.match(notifier, /Valor combinado com o professor:/);
  assert.match(notifier, /formatCurrencyBRL/);
});

test("student is sent directly to first tuition payment after enrollment", function () {
  assert.match(page, /const FIRST_TUITION_PAYMENT_PATH = "\/pagamento\//);
  assert.match(page, /window\.location\.replace\(getPostEnrollmentPath\(\)\)/);
  assert.match(page, /CONCLUIR MATRÍCULA E PAGAR/);
  assert.match(page, /primeira mensalidade ficará disponível/);
});

test("first tuition remains immediately visible while later cycles keep the two-day rule", function () {
  assert.match(paymentAvailability, /mt\.reference_month = settings\.billing_start_month/i);
  assert.match(paymentAvailability, /previous_tuition\.payment_date <= local_today - 2/i);
});
