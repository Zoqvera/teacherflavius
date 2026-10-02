const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const professorHome = read("professor_home.js");
const mensalidades = read("mensalidades.js");
const paymentControl = read("payment_creation_control.js");
const systemHealth = read("system_health_dashboard.js");
const healthHtml = read("saude-do-sistema/index.html");
const studentAccess = read("acessos_dos_alunos.js");
const lessonEditor = read("criar_licao.js");
const trialScheduler = read("trial_lesson_scheduler.js");
const studentsOfDay = read("alunos-do-dia/alunos_do_dia.js");

test("professor dashboard no longer exposes MFA step-up routing", function () {
  assert.equal(professorHome.includes("ProfessorMfaGate"), false);
  assert.equal(professorHome.includes("requireAal2"), false);
  assert.equal(professorHome.includes('get("mfa")'), false);
  assert.equal(professorHome.includes("?mfa=1"), false);
  assert.match(professorHome, /Professor autenticado:/);
});

test("administrative pages rely on the teacher role without MFA client gates", function () {
  for (const source of [
    studentAccess,
    lessonEditor,
    trialScheduler,
    studentsOfDay,
    mensalidades,
    systemHealth
  ]) {
    assert.equal(source.includes("ProfessorMfaGate"), false);
    assert.equal(source.includes("requireAal2"), false);
  }

  assert.equal(mensalidades.includes("is_teacher_admin_mfa"), false);
  assert.equal(mensalidades.includes("redirectToFinancialStepUp"), false);
  assert.equal(systemHealth.includes("auth_admin_without_verified_mfa"), false);
});

test("financial control fallback no longer redirects to MFA enrollment", function () {
  assert.equal(paymentControl.includes("MFA/AAL2"), false);
  assert.equal(paymentControl.includes("?mfa=1"), false);
  assert.match(paymentControl, /ACESSO INDISPONÍVEL/);
});

test("system health page does not load MFA assets", function () {
  assert.equal(healthHtml.includes("/professor_mfa_service.js"), false);
  assert.equal(healthHtml.includes("/professor_mfa_gate.js"), false);
  assert.equal(healthHtml.includes("MFA administrativo"), false);
});
