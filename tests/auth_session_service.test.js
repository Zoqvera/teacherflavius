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

function createDependencies(client) {
  return {
    getClient: function () { return client; },
    requireClient: function () { return client; },
    getGoogleRedirectUrl: function () { return "https://teacherflavius.com/login/?oauth=google"; },
    getGoogleLinkRedirectUrl: function () { return "https://teacherflavius.com/perfil/?google_linked=1"; },
    getPasswordRecoveryRedirectUrl: function () { return "https://teacherflavius.com/login/"; },
    loginPath: "/login/"
  };
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

test("rejects passwords shorter than eight characters before calling Supabase", async function () {
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
    service.updatePassword("1234567"),
    /pelo menos 8 caracteres/
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
