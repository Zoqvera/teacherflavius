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

function createService(client) {
  return loadService().create({
    getClient: function () { return client; },
    requireClient: function () { return client; },
    getGoogleRedirectUrl: function () { return "https://teacherflavius.com/login/"; },
    getGoogleLinkRedirectUrl: function () { return "https://teacherflavius.com/perfil/"; },
    getPasswordRecoveryRedirectUrl: function () { return "https://teacherflavius.com/login/"; },
    loginPath: "/login/"
  });
}

test("voluntary password change sends the current credential to Supabase", async function () {
  const calls = [];
  const client = {
    auth: {
      updateUser: async function (payload) {
        calls.push(payload);
        return { data: { user: { id: "user-1" } }, error: null };
      }
    }
  };

  const result = await createService(client).changePassword(
    "abcdefghijkl",
    "mnopqrstuvwx"
  );

  assert.equal(result.user.id, "user-1");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].currentPassword, "abcdefghijkl");
  assert.equal(calls[0].password, "mnopqrstuvwx");
});

test("voluntary password change rejects missing current credential and reuse", async function () {
  let updateCalls = 0;
  const client = {
    auth: {
      updateUser: async function () {
        updateCalls += 1;
        return { data: {}, error: null };
      }
    }
  };
  const service = createService(client);

  await assert.rejects(
    service.changePassword("", "mnopqrstuvwx"),
    /senha atual/
  );
  await assert.rejects(
    service.changePassword("abcdefghijkl", "abcdefghijkl"),
    /diferente da senha atual/
  );
  assert.equal(updateCalls, 0);
});

test("session revocation uses global sign-out scope", async function () {
  const scopes = [];
  const client = {
    auth: {
      signOut: async function (options) {
        scopes.push(options.scope);
        return { error: null };
      }
    }
  };

  await createService(client).revokeAllSessions();

  assert.deepEqual(scopes, ["global"]);
});
