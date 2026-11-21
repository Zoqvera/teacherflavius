const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadConsent, decideConsent } = require("../oauth_consent.js");

function fakeAuth(admin = true) {
  const calls = [];
  const oauth = {
    getAuthorizationDetails: async id => { calls.push(["details", id]); return { data: { client: { id: "client", name: "App" } } }; },
    approveAuthorization: async (id, options) => { calls.push(["approve", id, options]); return { data: { redirect_url: "https://example.org/callback" } }; },
    denyAuthorization: async (id, options) => { calls.push(["deny", id, options]); return { data: { redirect_url: "https://example.org/callback" } }; },
  };
  return { calls, requireAuth: async () => ({ id: "teacher" }), isTeacherAdmin: async () => admin, getClient: () => ({ auth: { oauth } }) };
}

test("consulta os detalhes apenas para professor autenticado", async () => {
  const auth = fakeAuth();
  assert.equal((await loadConsent(auth, "request_123")).client.name, "App");
  assert.deepEqual(auth.calls, [["details", "request_123"]]);
  const student = fakeAuth(false);
  await assert.rejects(loadConsent(student, "request_123"), /restrito/);
  assert.deepEqual(student.calls, []);
  await assert.rejects(loadConsent(auth, "../other"), /inválida/);
});

test("envia explicitamente a decisão e não redireciona pela biblioteca", async () => {
  const auth = fakeAuth();
  assert.equal(await decideConsent(auth, "request_123", "approve"), "https://example.org/callback");
  assert.equal(await decideConsent(auth, "request_123", "deny"), "https://example.org/callback");
  assert.deepEqual(auth.calls, [["approve", "request_123", { skipBrowserRedirect: true }], ["deny", "request_123", { skipBrowserRedirect: true }]]);
});
