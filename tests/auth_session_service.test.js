const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadService() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "auth_session_service.js"),
    "utf8"
  );
  const context = { window: { location: { replace: function () {} } } };
  vm.runInNewContext(source, context);
  return context.window.AuthSessionService;
}

function createStorage() {
  const data = new Map();
  return {
    getItem: function (key) { return data.has(key) ? data.get(key) : null; },
    setItem: function (key, value) { data.set(key, String(value)); },
    removeItem: function (key) { data.delete(key); }
  };
}

function createDependencies(client, overrides) {
  return Object.assign({
    getClient: function () { return client; },
    requireClient: function () { return client; },
    getGoogleRedirectUrl: function () { return "https://teacherflavius.com/login/?oauth=google"; },
    getGoogleLinkRedirectUrl: function () { return "https://teacherflavius.com/perfil/?google_linked=1"; },
    getPasswordRecoveryRedirectUrl: function () { return "https://teacherflavius.com/login/"; },
    loginPath: "/login/"
  }, overrides || {});
}

test("requests password reset with normalized email and trusted redirect", async function () {
  const calls = [];
  const client = {
    auth: {
      resetPasswordForEmail: async function (email, options) {
        calls.push({ email: email, options: options });
        return { data: { ok: true }, error: null };
      }
    }
  };
  const service = loadService().create(createDependencies(client));

  const result = await service.requestPasswordReset("  STUDENT@Example.COM  ");

  assert.deepEqual(result, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "student@example.com");
  assert.equal(calls[0].options.redirectTo, "https://teacherflavius.com/login/");
});

test("enforces a local cooldown between password reset requests", async function () {
  let resetCalls = 0;
  let now = 1000;
  const client = {
    auth: {
      resetPasswordForEmail: async function () {
        resetCalls += 1;
        return { data: { ok: true }, error: null };
      }
    }
  };
  const service = loadService().create(createDependencies(client, {
    now: function () { return now; },
    throttleStorage: createStorage()
  }));

  await service.requestPasswordReset("student@example.com");
  await assert.rejects(
    service.requestPasswordReset("student@example.com"),
    /Aguarde 60 segundos/
  );
  assert.equal(resetCalls, 1);

  now += 60 * 1000;
  await service.requestPasswordReset("student@example.com");
  assert.equal(resetCalls, 2);
});

test("does not expose Supabase password reset errors directly", async function () {
  const client = {
    auth: {
      resetPasswordForEmail: async function () {
        return {
          data: null,
          error: new Error("User not found for this email")
        };
      }
    }
  };
  const service = loadService().create(createDependencies(client, {
    throttleStorage: createStorage()
  }));

  await assert.rejects(
    service.requestPasswordReset("missing@example.com"),
    /Não foi possível solicitar a recuperação agora/
  );
});

test("throttles password login after repeated failures", async function () {
  let signInCalls = 0;
  let now = 1000;
  const client = {
    auth: {
      signInWithPassword: async function () {
        signInCalls += 1;
        return { data: null, error: new Error("Invalid login credentials") };
      }
    }
  };
  const service = loadService().create(createDependencies(client, {
    now: function () { return now; },
    throttleStorage: createStorage()
  }));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(service.signIn("student@example.com", "wrong-password"));
  }

  await assert.rejects(
    service.signIn("student@example.com", "wrong-password"),
    /Muitas tentativas de acesso. Aguarde 5 segundos/
  );
  assert.equal(signInCalls, 3);

  now += 5 * 1000;
  await assert.rejects(service.signIn("student@example.com", "wrong-password"));
  assert.equal(signInCalls, 4);
});

test("clears password login throttle after a successful sign in", async function () {
  let shouldFail = true;
  let now = 1000;
  const storage = createStorage();
  const client = {
    auth: {
      signInWithPassword: async function () {
        if (shouldFail) return { data: null, error: new Error("Invalid login credentials") };
        return { data: { user: { id: "user-1" } }, error: null };
      }
    }
  };
  const service = loadService().create(createDependencies(client, {
    now: function () { return now; },
    throttleStorage: storage
  }));

  await assert.rejects(service.signIn("student@example.com", "wrong-password"));
  await assert.rejects(service.signIn("student@example.com", "wrong-password"));
  shouldFail = false;
  const result = await service.signIn("student@example.com", "correct-password");
  assert.equal(result.user.id, "user-1");

  shouldFail = true;
  await assert.rejects(service.signIn("student@example.com", "wrong-password"));
  await assert.rejects(service.signIn("student@example.com", "wrong-password"));
  assert.equal(now, 1000);
});

test("rejects passwords shorter than twelve characters before calling Supabase", async function () {
  let updateCalls = 0;
  const client = {
    auth: {
      updateUser: async function () {
        updateCalls += 1;
        return { data: {}, error: null };
      }
    }
  };
  const service = loadService().create(createDependencies(client));

  await assert.rejects(
    service.updatePassword("12345678901"),
    /pelo menos 12 caracteres/
  );
  assert.equal(updateCalls, 0);
});

test("updates password through authenticated Supabase user", async function () {
  const calls = [];
  const client = {
    auth: {
      updateUser: async function (payload) {
        calls.push(payload);
        return { data: { user: { id: "user-1" } }, error: null };
      }
    }
  };
  const service = loadService().create(createDependencies(client));

  const result = await service.updatePassword("new-password-123");

  assert.equal(result.user.id, "user-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].password, "new-password-123");
});
