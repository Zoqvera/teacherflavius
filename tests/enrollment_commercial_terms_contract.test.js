const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const historicalMigration = read(
  "supabase/migrations/20261004074423_student_sets_enrollment_commercial_terms.sql"
);
const historicalBaseline = read(
  "supabase/baseline/145_student_sets_enrollment_commercial_terms.sql"
);
const migration = read(
  "supabase/migrations/20261006042754_bind_enrollment_terms_to_access_code.sql"
);
const baseline = read(
  "supabase/baseline/265_bind_enrollment_terms_to_access_code.sql"
);
const notifier = read("supabase/functions/notify-new-enrollment/index.ts");
const paymentAvailability = read(
  "supabase/baseline/95_unlock_next_tuition_two_days_after_payment.sql"
);

test("new enrollment form does not let the student choose commercial terms", function () {
  assert.doesNotMatch(page, /id="classesPerMonth"/);
  assert.doesNotMatch(page, /id="monthlyFee"/);
  assert.doesNotMatch(page, /parseMonthlyFee/);
  assert.doesNotMatch(page, /target_monthly_fee:/);
  assert.match(
    page,
    /código é validado com segurança e define automaticamente o valor da mensalidade e a quantidade de aulas mensais/i
  );
});

test("enrollment saves due-day choice before server-authoritative commercial terms and profile activation", function () {
  const dueDayIndex = page.indexOf("StudentTuitionDueDay.saveSelection");
  const billingIndex = page.indexOf("set_my_enrollment_billing_terms");
  const profileIndex = page.indexOf("Auth.completeProfile");

  assert.ok(dueDayIndex >= 0);
  assert.ok(billingIndex > dueDayIndex);
  assert.ok(profileIndex > billingIndex);
  assert.match(
    page,
    /rpc\("set_my_enrollment_billing_terms"\)/
  );
});

test("access-code authorization stores the server-authoritative monthly fee and lesson quantity", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /add column if not exists monthly_fee numeric\(10, 2\)/i);
    assert.match(sql, /add column if not exists classes_per_month smallint/i);
    assert.match(sql, /from vault\.decrypted_secrets secret/i);
    assert.match(sql, /configured_plans := secret_payload::jsonb/i);
    assert.match(sql, /selected_plan := configured_plans -> normalized_code/i);
    assert.match(sql, /monthly_fee = authorized_monthly_fee/i);
    assert.match(sql, /classes_per_month = authorized_classes_per_month/i);
  }
});

test("billing RPC ignores client pricing and uses only the authorized code terms", function () {
  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /target_monthly_fee numeric default null/i
    );
    assert.match(
      sql,
      /select access\.monthly_fee, access\.classes_per_month[\s\S]*into authorized_monthly_fee, authorized_classes_per_month/i
    );
    assert.doesNotMatch(sql, /round\(target_monthly_fee/i);
    assert.doesNotMatch(sql, /private\.enrollment_classes_per_month_for_fee\(target_monthly_fee/i);
    assert.match(
      sql,
      /values \([\s\S]*caller_id,[\s\S]*authorized_monthly_fee,[\s\S]*authorized_classes_per_month/i
    );
  }
});

test("enrollment billing RPC remains restricted to pre-enrollment authorized students", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /coalesce\(profile_row\.enrolled, false\)/i);
    assert.match(sql, /coalesce\(profile_row\.profile_completed, false\)/i);
    assert.match(sql, /from private\.student_enrollment_access access/i);
    assert.match(
      sql,
      /Valide um código de matrícula com condições comerciais antes de continuar/i
    );
  }
});

test("profile activation revalidates billing terms against the authorized access code", function () {
  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /select access\.monthly_fee, access\.classes_per_month[\s\S]*into authorized_monthly_fee, authorized_classes_per_month/i
    );
    assert.match(sql, /select settings\.monthly_fee, settings\.classes_per_month/i);
    assert.match(
      sql,
      /billing_monthly_fee is distinct from authorized_monthly_fee/i
    );
    assert.match(
      sql,
      /billing_classes_per_month is distinct from authorized_classes_per_month/i
    );
  }
});

test("existing enrollment activation still generates the first tuition after enrollment", function () {
  for (const sql of [historicalMigration, historicalBaseline]) {
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

test("only new enrollment is sent directly to first tuition payment", function () {
  assert.match(page, /const FIRST_TUITION_PAYMENT_PATH = "\/pagamento\//);
  assert.match(
    page,
    /state\.mode === NEW_ENROLLMENT_MODE[\s\S]*getPostEnrollmentPath\(\)[\s\S]*getNextPath\(\)/
  );
  assert.match(page, /CONCLUIR MATRÍCULA E PAGAR/);
  assert.match(page, /SALVAR DADOS E ACESSAR/);
  assert.match(page, /primeira mensalidade ficará disponível/);
});

test("first tuition remains immediately visible while later cycles keep the two-day rule", function () {
  assert.match(paymentAvailability, /mt\.reference_month = settings\.billing_start_month/i);
  assert.match(paymentAvailability, /previous_tuition\.payment_date <= local_today - 2/i);
});
