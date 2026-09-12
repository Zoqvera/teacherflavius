const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function loadGuard(pathname) {
  const source = read("auth_guard_service.js");
  const location = {
    pathname: pathname,
    search: "",
    href: "",
    replacedWith: "",
    replace: function (value) { this.replacedWith = value; }
  };
  const context = { console: console, window: { location: location } };
  vm.runInNewContext(source, context);
  return { module: context.window.AuthGuardService, location: location };
}

function guardOptions(overrides) {
  const user = { id: "user-1" };
  return Object.assign({
    isConfigured: function () { return true; },
    showConfigWarning: function () {},
    getSession: async function () { return { user: user }; },
    ensureProfileForUser: async function () {
      return { profile_completed: true, enrolled: true, archived: false };
    },
    isTeacherAdmin: async function () { return false; },
    normalizeNextPath: function (value) { return value; },
    loginPath: "/login/",
    onboardingPath: "/complete-cadastro/",
    profilePath: "/perfil/",
    studentAreaPath: "/area-do-estudante/",
    accessDeniedPath: "/acesso-negado/"
  }, overrides || {});
}

test("student access dashboard loads the MFA gate before its application script", function () {
  const html = read("acessos_dos_alunos.html");
  const serviceIndex = html.indexOf("/professor_mfa_service.js");
  const gateIndex = html.indexOf("/professor_mfa_gate.js");
  const appIndex = html.indexOf("acessos_dos_alunos.js");

  assert.ok(serviceIndex >= 0, "MFA service must be loaded");
  assert.ok(gateIndex > serviceIndex, "MFA gate must load after its service");
  assert.ok(appIndex > gateIndex, "dashboard application must load after the MFA gate");
});

test("student access dashboard requires AAL2 before revealing administrative data", function () {
  const source = read("acessos_dos_alunos.js");
  const adminCheckIndex = source.indexOf("state.accessService.isTeacherAdmin()");
  const mfaIndex = source.indexOf("await requireAdministrativeMfa();");
  const revealIndex = source.indexOf("state.renderer.showDashboard();");

  assert.ok(adminCheckIndex >= 0, "teacher role check must exist");
  assert.ok(mfaIndex > adminCheckIndex, "MFA must follow teacher role validation");
  assert.ok(revealIndex > mfaIndex, "administrative UI must remain hidden until AAL2");
});

test("incomplete student profile is redirected to onboarding", async function () {
  const loaded = loadGuard("/atividade/");
  const service = loaded.module.create(guardOptions({
    ensureProfileForUser: async function () {
      return { profile_completed: false, enrolled: true, archived: false };
    }
  }));

  const user = await service.requireAuth();

  assert.equal(user, null);
  assert.match(loaded.location.replacedWith, /^\/complete-cadastro\/\?next=/);
});

test("teacher bypass can be disabled for student-only routes", async function () {
  const loaded = loadGuard("/atividade/");
  const service = loaded.module.create(guardOptions({
    isTeacherAdmin: async function () { return true; },
    ensureProfileForUser: async function () {
      return { profile_completed: true, enrolled: false, archived: false };
    }
  }));

  const user = await service.requireAuth({ allowTeacher: false });

  assert.equal(user, null);
  assert.equal(loaded.location.replacedWith, "/acesso-negado/");
});

test("student resource guard fails closed when profile verification errors", async function () {
  const loaded = loadGuard("/atividade/");
  const service = loaded.module.create(guardOptions({
    ensureProfileForUser: async function () {
      throw new Error("profile unavailable");
    }
  }));

  const user = await service.requireAuth();

  assert.equal(user, null);
  assert.equal(loaded.location.replacedWith, "/acesso-negado/");
});
