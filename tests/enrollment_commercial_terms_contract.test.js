const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "complete-cadastro.html"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004074423_student_sets_enrollment_commercial_terms.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/145_student_sets_enrollment_commercial_terms.sql"),
  "utf8"
);
const notifier = fs.readFileSync(
  path.join(ROOT, "supabase/functions/notify-new-enrollment/index.ts"),
  "utf8"
);

test("new enrollment form requires monthly lesson quantity and agreed fee", function () {
  assert.match(page, /id="classesPerMonth"[^>]*required/);
  assert.match(page, /Quantidade de aulas por mês/);
  assert.match(page, /id="monthlyFee"[^>]*required/);
  assert.match(page, /Valor combinado com o professor/);
  assert.match(page, /Informe o valor mensal em reais/);
});

test("enrollment saves due-day choice before commercial terms and profile activation", function () {
  const dueDayIndex = page.indexOf("StudentTuitionDueDay.saveSelection");
  const billingIndex = page.indexOf("set_my_enrollment_billing_terms");
  const profileIndex = page.indexOf("Auth.completeProfile");

  assert.ok(dueDayIndex >= 0);
  assert.ok(billingIndex > dueDayIndex);
  assert.ok(profileIndex > billingIndex);
  assert.match(page, /target_classes_per_month: classesPerMonth/);
  assert.match(page, /target_monthly_fee: monthlyFee/);
});

test("database accepts commercial terms only before enrollment and after access-code authorization", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /create or replace function public\.set_my_enrollment_billing_terms/i);
    assert.match(sql, /coalesce\(profile_row\.enrolled, false\)/i);
    assert.match(sql, /coalesce\(profile_row\.profile_completed, false\)/i);
    assert.match(sql, /from private\.student_enrollment_access access/i);
    assert.match(sql, /target_classes_per_month < 1/i);
    assert.match(sql, /normalized_fee is null or normalized_fee <= 0/i);
    assert.match(sql, /classes_per_month = excluded\.classes_per_month/i);
  }
});

test("profile activation requires stored fee and lesson quantity", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /select settings\.monthly_fee, settings\.classes_per_month/i);
    assert.match(sql, /billing_monthly_fee <= 0/i);
    assert.match(sql, /billing_classes_per_month is null/i);
    assert.match(sql, /Informe a quantidade de aulas por mês e o valor combinado com o professor/i);
  }
});

test("first tuition is generated after enrollment becomes active", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /private\.ensure_first_tuition_after_profile_enrollment/i);
    assert.match(sql, /after update of enrolled on public\.profiles/i);
    assert.match(sql, /private\.ensure_first_tuition_for_student/i);
  }
});

test("new enrollment email contains lesson quantity and agreed monthly fee", function () {
  assert.match(notifier, /\.from\("student_billing_settings"\)/);
  assert.match(notifier, /\.select\("monthly_fee, classes_per_month"\)/);
  assert.match(notifier, /Quantidade de aulas por mês:/);
  assert.match(notifier, /Valor combinado com o professor:/);
  assert.match(notifier, /formatCurrencyBRL/);
});
