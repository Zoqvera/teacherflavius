const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20261107143000_student_financial_responsibilities.sql"),
  "utf8",
);

test("payer sponsorship is not a tuition exemption", () => {
  assert.match(migration, /create table if not exists private\.student_financial_responsibilities/i);
  assert.match(migration, /payer_student_id uuid not null/i);
  assert.match(migration, /beneficiary_student_id uuid not null/i);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
  assert.doesNotMatch(migration, /update public\.student_billing_settings/i);
});

test("financial responsibility is month-based and one active payer per beneficiary", () => {
  assert.match(migration, /first_reference_month date not null/i);
  assert.match(migration, /first_uncovered_month date/i);
  assert.match(migration, /one_active_financial_responsibility_per_student/i);
  assert.match(migration, /payer_student_id <> beneficiary_student_id/i);
  assert.match(migration, /Não é permitido encadear responsáveis financeiros/i);
});

test("administrative operations validate server-side authority and unsettled payments", () => {
  assert.match(migration, /public\.is_teacher_admin\(\)/i);
  assert.match(migration, /auth\.uid\(\) is null/i);
  assert.match(migration, /tuition\.payment_date is not null or tuition\.is_exempt/i);
  assert.match(migration, /'created', 'pending', 'authorized', 'in_process', 'in_mediation'/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
});

test("private data has RLS with no client table access", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on private\.student_financial_responsibilities from anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.set_teacher_financial_responsibility/i);
});
