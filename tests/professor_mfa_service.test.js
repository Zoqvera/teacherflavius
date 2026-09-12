const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadService() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "professor_mfa_service.js"),
    "utf8"
  );
  const context = {
    window: {},
    setTimeout: setTimeout,
    Promise: Promise
  };
  vm.runInNewContext(source, context);
  return context.window.ProfessorMfaService;
}

function createStorage() {
  const data = new Map();
  return {
    getItem: function (key) { return data.has(key) ? data.get(key) : null; },
    setItem: function (key, value) { data.set(key, String(value)); }
  };
}

function createService(client, overrides) {
  return loadService().create(Object.assign({
    getClient: function () { return client; }
  }, overrides || {}));
}

test("accepts an existing aal2 session without listing factors", async function () {
  let listCalls = 0;
  const client = {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async function () {
          return { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null };
        },
        listFactors: async function () {
          listCalls += 1;
          return { data: { totp: [] }, error: null };
        }
      }
    }
  };

  const state = await createService(client).getState();

  assert.equal(state.status, "verified");
  assert.equal(listCalls, 0);
});

test("expires an aal2 administrative session after thirty minutes of inactivity", async function () {
  let now = 1000;
  let intervalCallback = null;
  const signOutScopes = [];
  const redirects = [];
  const documentRef = {
    visibilityState: "visible",
    addEventListener: function () {}
  };
  const windowRef = {
    location: {
      replace: function (value) { redirects.push(value); }
    }
  };
  const client = {
    auth: {
      signOut: async function (options) {
        signOutScopes.push(options.scope);
        return { error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async function () {
          return { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null };
        }
      }
    }
  };

  const service = createService(client, {
    now: function () { return now; },
    documentRef: documentRef,
    windowRef: windowRef,
    activityStorage: createStorage(),
    setIntervalFn: function (callback) {
      intervalCallback = callback;
      return 1;
    },
    clearIntervalFn: function () {},
    idleTimeoutMs: 30 * 60 * 1000
  });

  await service.getState();
  assert.equal(typeof intervalCallback, "function");

  now += 30 * 60 * 1000 + 1;
  await intervalCallback();

  assert.deepEqual(signOutScopes, ["local"]);
  assert.deepEqual(redirects, ["/login/?logged_out=1&idle_timeout=1"]);
});

test("recent activity keeps an aal2 administrative session alive", async function () {
  let now = 1000;
  let intervalCallback = null;
  const listeners = {};
  let signOutCalls = 0;
  const documentRef = {
    visibilityState: "visible",
    addEventListener: function (eventName, callback) {
      listeners[eventName] = callback;
    }
  };
  const client = {
    auth: {
      signOut: async function () {
        signOutCalls += 1;
        return { error: null };
      },
      mfa: {
        getAuthenticatorAssuranceLevel: async function () {
          return { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null };
        }
      }
    }
  };

  const service = createService(client, {
    now: function () { return now; },
    documentRef: documentRef,
    windowRef: { location: { replace: function () {} } },
    activityStorage: createStorage(),
    setIntervalFn: function (callback) {
      intervalCallback = callback;
      return 1;
    },
    clearIntervalFn: function () {},
    idleTimeoutMs: 30 * 60 * 1000
  });

  await service.getState();
  now += 25 * 60 * 1000;
  listeners.keydown();
  now += 10 * 60 * 1000;
  await intervalCallback();

  assert.equal(signOutCalls, 0);
});

test("requires a challenge when a verified TOTP factor exists", async function () {
  const client = {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: async function () {
          return { data: { currentLevel: "aal1", nextLevel: "aal2" }, error: null };
        },
        listFactors: async function () {
          return {
            data: {
              totp: [{ id: "factor-1", factor_type: "totp", status: "verified" }]
            },
            error: null
          };
        }
      }
    }
  };

  const state = await createService(client).getState();

  assert.equal(state.status, "challenge");
  assert.equal(state.factor.id, "factor-1");
});

test("removes stale unverified TOTP factor before enrolling a new factor", async function () {
  const unenrolled = [];
  const enrollCalls = [];
  const client = {
    auth: {
      mfa: {
        listFactors: async function () {
          return {
            data: {
              all: [{ id: "stale-factor", factor_type: "totp", status: "unverified" }]
            },
            error: null
          };
        },
        unenroll: async function (payload) {
          unenrolled.push(payload);
          return { data: {}, error: null };
        },
        enroll: async function (payload) {
          enrollCalls.push(payload);
          return {
            data: {
              id: "new-factor",
              totp: {
                qr_code: "data:image/svg+xml;base64,abc",
                secret: "SECRET",
                uri: "otpauth://totp/example"
              }
            },
            error: null
          };
        }
      }
    }
  };

  const enrollment = await createService(client).enrollTotp();

  assert.equal(unenrolled.length, 1);
  assert.equal(unenrolled[0].factorId, "stale-factor");
  assert.equal(enrollCalls.length, 1);
  assert.equal(enrollCalls[0].factorType, "totp");
  assert.equal(enrollment.id, "new-factor");
});

test("rejects invalid TOTP code before creating a challenge", async function () {
  let challengeCalls = 0;
  const client = {
    auth: {
      mfa: {
        challenge: async function () {
          challengeCalls += 1;
          return { data: { id: "challenge-1" }, error: null };
        }
      }
    }
  };

  await assert.rejects(
    createService(client).verifyFactor("factor-1", "12345"),
    /6 dígitos/
  );
  assert.equal(challengeCalls, 0);
});

test("verifies a valid TOTP code and confirms session promotion to aal2", async function () {
  const calls = [];
  let assuranceCalls = 0;
  const client = {
    auth: {
      mfa: {
        challenge: async function (payload) {
          calls.push({ method: "challenge", payload: payload });
          return { data: { id: "challenge-1" }, error: null };
        },
        verify: async function (payload) {
          calls.push({ method: "verify", payload: payload });
          return { data: { ok: true }, error: null };
        },
        getAuthenticatorAssuranceLevel: async function () {
          assuranceCalls += 1;
          return { data: { currentLevel: "aal2", nextLevel: "aal2" }, error: null };
        }
      }
    }
  };

  const result = await createService(client).verifyFactor("factor-1", "123456");

  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "challenge");
  assert.equal(calls[0].payload.factorId, "factor-1");
  assert.equal(calls[1].method, "verify");
  assert.equal(calls[1].payload.factorId, "factor-1");
  assert.equal(calls[1].payload.challengeId, "challenge-1");
  assert.equal(calls[1].payload.code, "123456");
  assert.equal(assuranceCalls, 1);
});
