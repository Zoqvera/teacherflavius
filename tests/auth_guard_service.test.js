const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadService(pathname) {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "auth_guard_service.js"),
    "utf8"
  );
  const location = {
    pathname: pathname || "/atividade/",
    search: "",
    href: "",
    replacedWith: "",
    replace: function (value) { this.replacedWith = value; }
  };
  const context = {
    console: console,
    window: { location: location }
  };
  vm.runInNewContext(source, context);
  return { module: context.window.AuthGuardService, location: location };
}

function createOptions(overrides) {
  const user = { id: "user-1" };
  const defaults = {
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
  };
  return Object.assign(defaults, overrides || {});
}

test("redirects anonymous users to login", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions({
    getSession: async function () { return null; }
  }));

  const user = await service.requireAuth();

  assert.equal(user, null);
  assert.match(loaded.location.href, /^\/login\/\?next=/);
});

test("allows active enrolled students", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions());

  const user = await service.requireAuth();

  assert.equal(user.id, "user-1");
  assert.equal(loaded.location.replacedWith, "");
});

test("blocks completed profiles without active enrollment", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions({
    ensureProfileForUser: async function () {
      return { profile_completed: true, enrolled: false, archived: false };
    }
  }));

  const user = await service.requireAuth();

  assert.equal(user, null);
  assert.equal(loaded.location.replacedWith, "/acesso-negado/");
});

test("blocks archived students", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions({
    ensureProfileForUser: async function () {
      return { profile_completed: true, enrolled: true, archived: true };
    }
  }));

  const user = await service.requireAuth();

  assert.equal(user, null);
  assert.equal(loaded.location.replacedWith, "/acesso-negado/");
});

test("allows teacher without requiring a student profile", async function () {
  const loaded = loadService("/atividade/");
  let profileChecks = 0;
  const service = loaded.module.create(createOptions({
    isTeacherAdmin: async function () { return true; },
    ensureProfileForUser: async function () {
      profileChecks += 1;
      return null;
    }
  }));

  const user = await service.requireAuth();

  assert.equal(user.id, "user-1");
  assert.equal(profileChecks, 0);
});

test("keeps profile page available to authenticated inactive accounts", async function () {
  const loaded = loadService("/perfil/");
  const service = loaded.module.create(createOptions({
    ensureProfileForUser: async function () {
      return { profile_completed: true, enrolled: false, archived: true };
    }
  }));

  const user = await service.requireAuth();

  assert.equal(user.id, "user-1");
  assert.equal(loaded.location.replacedWith, "");
});

test("routes network failures during session lookup to retryable connection screen", async function () {
  const loaded = loadService("/area-do-estudante/");
  const service = loaded.module.create(createOptions({
    getSession: async function () { throw new TypeError("Load failed"); }
  }));

  assert.equal(await service.requireAuth(), null);
  assert.equal(
    loaded.location.replacedWith,
    "/acesso-negado/?reason=connection&next=%2Farea-do-estudante%2F"
  );
});

test("routes network failures during profile lookup to connection screen", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions({
    ensureProfileForUser: async function () { throw new TypeError("Failed to fetch"); }
  }));

  assert.equal(await service.requireAuth(), null);
  assert.equal(
    loaded.location.replacedWith,
    "/acesso-negado/?reason=connection&next=%2Fatividade%2F"
  );
});

test("routes Supabase service outages to connection screen", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions({
    ensureProfileForUser: async function () {
      const error = new Error("Service Unavailable");
      error.status = 503;
      throw error;
    }
  }));

  assert.equal(await service.requireAuth(), null);
  assert.match(loaded.location.replacedWith, /reason=connection/);
});

test("does not present unknown verification failures as authorization denial", async function () {
  const loaded = loadService("/atividade/");
  const service = loaded.module.create(createOptions({
    ensureProfileForUser: async function () { throw new Error("Unexpected backend response"); }
  }));

  assert.equal(await service.requireAuth(), null);
  assert.match(loaded.location.replacedWith, /reason=verification/);
});
