const test = require("node:test");
const assert = require("node:assert/strict");
const Probe = require("../scripts/mercado_pago_sandbox_probe.js");

test("skips sandbox probe when the test credential is not configured", async () => {
  let called = false;
  const result = await Probe.probeCredential({
    token: "",
    fetchImpl: async function () {
      called = true;
      throw new Error("should not be called");
    }
  });

  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "missing_test_access_token");
});

test("uses a read-only authenticated GET request for the sandbox credential probe", async () => {
  const calls = [];
  const result = await Probe.probeCredential({
    token: "test-secret-token",
    fetchImpl: async function (url, options) {
      calls.push({ url: url, options: options });
      return { ok: true, status: 200 };
    },
    timeoutMs: 1000
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, Probe.USER_ENDPOINT);
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-secret-token");
  assert.equal(calls[0].options.headers.Accept, "application/json");
  assert.equal(Object.prototype.hasOwnProperty.call(calls[0].options, "body"), false);
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.endpoint, "/users/me");
});

test("does not expose the access token in network failure messages", async () => {
  const token = "very-sensitive-test-token";

  await assert.rejects(
    Probe.probeCredential({
      token: token,
      fetchImpl: async function () {
        throw new Error("network failure with internal details");
      }
    }),
    function (error) {
      assert.doesNotMatch(error.message, new RegExp(token));
      assert.match(error.message, /could not reach the API/);
      return true;
    }
  );
});

test("does not expose the access token when the provider rejects the request", async () => {
  const token = "another-sensitive-test-token";

  await assert.rejects(
    Probe.probeCredential({
      token: token,
      fetchImpl: async function () {
        return { ok: false, status: 401 };
      }
    }),
    function (error) {
      assert.doesNotMatch(error.message, new RegExp(token));
      assert.match(error.message, /HTTP 401/);
      return true;
    }
  );
});
