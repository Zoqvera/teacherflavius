const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

const enrollment = read("complete-cadastro.html");
const checkout = read("pagamento/app.js");
const checkoutMarkup = read("pagamento/index.html");
const gateway = read("supabase/functions/create-mercado-pago-payment/index.ts");
const migration = read("supabase/migrations/20261013143000_same_day_first_tuition_payment.sql");
const baseline = read("supabase/baseline/380_same_day_first_tuition_payment.sql");

test("new enrollment no longer offers a due-date selection", () => {
  assert.doesNotMatch(enrollment, /StudentTuitionDueDay|student_tuition_due_day\.js|tuitionDueDate/);
  assert.match(enrollment, /O vencimento da primeira mensalidade será definido automaticamente/);
  assert.match(enrollment, /const FIRST_TUITION_PAYMENT_PATH = "\/pagamento\/"/);
  assert.match(enrollment, /state\.mode === NEW_ENROLLMENT_MODE[\s\S]*getPostEnrollmentPath\(\)/);
  assert.match(enrollment, /set_my_enrollment_billing_terms/);
  assert.match(enrollment, /Auth\.completeProfile/);
});

test("enrollment activation uses the São Paulo date and marks only newly activated students", () => {
  assert.equal(migration, baseline);
  assert.match(migration, /add column if not exists first_payment_same_day_required boolean not null default false/);
  assert.match(migration, /automatic_first_due_date := anchor_date/);
  assert.match(migration, /anchor_date := timezone\('America\/Sao_Paulo', now\(\)\)::date/);
  assert.match(migration, /new\.tuition_first_due_date := automatic_first_due_date/);
  assert.match(migration, /new\.tuition_due_day_source := 'system'/);
  assert.match(migration, /new\.first_payment_same_day_required := true/);
  assert.match(migration, /new\.enrolled := true/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition\s+set/i);
  assert.doesNotMatch(migration, /update public\.profiles\s+set first_payment_same_day_required\s*=\s*true/i);
});

test("back-end exact-date and legacy-day APIs no longer permit next-day choice", () => {
  assert.match(migration, /select array\[\s*target_enrollment_date\s*\]::date\[\]/i);
  assert.match(migration, /chosen_first_due_date <> enrollment_date/);
  assert.match(migration, /O primeiro vencimento é definido automaticamente/);
  assert.match(migration, /'requires_tuition_due_date', false/);
  assert.match(migration, /guard_first_payment_policy_from_student/);
  assert.match(migration, /auth\.uid\(\) = new\.id/i);
});

test("server enforces cutoff for only new unpaid first-month tuition", () => {
  assert.match(migration, /tuition\.reference_month = billing\.billing_start_month/);
  assert.match(migration, /tuition\.due_date = profile\.tuition_first_due_date/);
  assert.match(migration, /tuition\.payment_date is null/);
  assert.match(migration, /timezone\('America\/Sao_Paulo', now\(\)\)::date > profile\.tuition_first_due_date/);
  assert.match(migration, /profile\.first_payment_same_day_required/);
  assert.match(migration, /grant execute on function public\.is_first_tuition_payment_closed\(uuid\)\s+to service_role/i);
  assert.match(migration, /grant execute on function public\.get_my_first_payment_window\(\)\s+to authenticated, service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.is_first_tuition_payment_closed\(uuid\)\s+to authenticated/i);
});

test("gateway preserves existing payment attempts before enforcing no new ones", () => {
  const oldProvider = gateway.indexOf("if (sameAttempt?.provider_payment_id)");
  const recentProvider = gateway.indexOf("if (activeAttempt?.provider_payment_id)");
  const deadline = gateway.indexOf('"is_first_tuition_payment_closed"');
  const newAttempt = gateway.indexOf("let attempt = sameAttempt;");
  const providerCall = gateway.indexOf('fetch("https://api.mercadopago.com/v1/payments"');
  assert.ok(oldProvider >= 0 && oldProvider < recentProvider);
  assert.ok(recentProvider < deadline);
  assert.ok(deadline < newAttempt && newAttempt < providerCall);
  assert.match(gateway, /first_payment_deadline_expired/);
  assert.match(gateway, /payment_window_unavailable/);
  assert.match(gateway, /if \(windowError \|\| typeof windowClosed !== "boolean"\)/);
  assert.match(gateway, /\.eq\("student_id", user\.id\)/);
});

test("checkout explains administrative recovery without disabling verification", () => {
  assert.match(checkout, /get_my_first_payment_window/);
  assert.match(checkout, /isClosedFirstTuition/);
  assert.match(checkout, /showFirstPaymentClosed/);
  assert.match(checkout, /VERIFICAR PAGAMENTO NOVAMENTE/);
  assert.match(checkoutMarkup, /id="verifyPaymentButton"/);
  assert.match(checkoutMarkup, /noindex, nofollow/);
  assert.match(checkoutMarkup, /\/pagamento\/app\.js\?v=20261021-revert-1/);
});

test("month-end recurring due day keeps its original day with a short-month clamp", () => {
  const recurring = read("supabase/migrations/20261012201436_avoid_tuition_due_date_generation_conflicts.sql");
  assert.match(recurring, /least\(/i);
  assert.match(recurring, /s\.due_day::integer/i);
  assert.match(recurring, /interval '1 month - 1 day'/i);
  assert.match(recurring, /p\.tuition_first_due_date/i);
});

test("reconstruction includes policy overlay and fingerprint", () => {
  const workflow = read(".github/workflows/validate-supabase-baseline.yml");
  const fingerprint = JSON.parse(read("supabase/baseline/schema-fingerprint.json"));
  assert.match(workflow, /380_same_day_first_tuition_payment\.sql/);
  assert.equal(fingerprint.public_functions, 197);
  assert.equal(fingerprint.private_functions, 39);
  assert.equal(fingerprint.public_user_triggers, 47);
});
