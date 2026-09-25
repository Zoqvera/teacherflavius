const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const professorHome = read("professor_home.js");
const paymentControl = read("payment_creation_control.js");
const migration = read("supabase/migrations/20260925023000_tier_teacher_admin_mfa.sql");
const refundFunction = read("supabase/functions/refund-mercado-pago-payment/index.ts");
const chargebackFunction = read("supabase/functions/list-mercado-pago-chargebacks/index.ts");
const systemHealthFunction = read("supabase/functions/get-system-health-dashboard/index.ts");
const studentAccess = read("acessos_dos_alunos.js");
const lessonEditor = read("criar_licao.js");
const trialScheduler = read("trial_lesson_scheduler.js");
const studentsOfDay = read("alunos-do-dia/alunos_do_dia.js");

test("professor dashboard uses MFA only when explicit step-up is requested", function () {
  assert.match(professorHome, /professorStepUpRequested/);
  assert.match(professorHome, /get\("mfa"\) === "1"/);
  assert.match(professorHome, /runProfessorStepUp\(client\)/);
  assert.match(professorHome, /Professor autenticado:/);
});

test("routine professor pages do not request AAL2 on initial load", function () {
  for (const source of [studentAccess, lessonEditor, trialScheduler, studentsOfDay]) {
    assert.equal(source.includes("ProfessorMfaGate.requireAal2"), false);
    assert.equal(source.includes("is_teacher_admin_mfa"), false);
  }
});

test("database migration moves routine admin policies and functions to teacher role authorization", function () {
  assert.match(migration, /replace\(next_qual, 'public\.is_teacher_admin_mfa\(\)', 'public\.is_teacher_admin\(\)'\)/);
  assert.equal(migration.includes("function_record.definition"), true);
  assert.equal(migration.includes("'public.is_teacher_admin_mfa()'"), true);
  assert.equal(migration.includes("'public.is_teacher_admin()'"), true);
  assert.match(migration, /from pg_policies/);
  assert.match(migration, /tablename <> all/);
});

test("sensitive financial and privacy surfaces remain outside routine authorization conversion", function () {
  for (const protectedName of [
    "monthly_tuition",
    "monthly_tuition_events",
    "student_billing_settings",
    "data_retention_policies",
    "data_retention_runs",
    "data_subject_requests",
    "record_tuition_payment",
    "reverse_tuition_payment",
    "save_student_billing_settings",
    "delete_teacher_student",
    "close_student_account_for_privacy"
  ]) {
    assert.equal(migration.includes("'" + protectedName + "'"), true);
  }
});

test("financial and operational high-risk endpoints still require MFA", function () {
  assert.match(refundFunction, /is_teacher_admin_mfa/);
  assert.match(chargebackFunction, /is_teacher_admin_mfa/);
  assert.match(systemHealthFunction, /is_teacher_admin_mfa/);
});

test("financial controls route the teacher through explicit MFA step-up", function () {
  assert.match(paymentControl, /\/professor\/\?mfa=1&amp;next=%2Fmensalidades%2F/);
});
