const test = require("node:test");
const assert = require("node:assert/strict");
const Probe = require("../scripts/mercado_pago_sandbox_probe.js");

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

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

test("scheduled sandbox validation fails closed when the credential is required", async () => {
  await assert.rejects(
    Probe.runCli({ MERCADO_PAGO_REQUIRE_TEST_CREDENTIAL: "true" }),
    /test access token is not configured/
  );
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

test("sandbox card probe covers approval, idempotent replay, lookup and rejection", async () => {
  const calls = [];
  const responses = [
    jsonResponse({ id: "approved-card-token" }, 201),
    jsonResponse({ id: 101, status: "approved" }, 201),
    jsonResponse({ id: 101, status: "approved" }, 200),
    jsonResponse({ id: 101, status: "approved" }, 200),
    jsonResponse({ id: "rejected-card-token" }, 201),
    jsonResponse({ id: 202, status: "rejected" }, 201)
  ];
  const uuids = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ];

  const result = await Probe.probeCardPayments({
    accessToken: "test-access-token",
    publicKey: "test-public-key",
    payerEmail: "sandbox@example.test",
    paymentMethodId: "master",
    amount: 10,
    card: {
      number: "test-card-number",
      securityCode: "test-code",
      expirationMonth: 11,
      expirationYear: 2030
    },
    randomUuid: function () { return uuids.shift(); },
    fetchImpl: async function (url, options) {
      calls.push({ url, options });
      return responses.shift();
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.approved_status, "approved");
  assert.equal(result.rejected_status, "rejected");
  assert.equal(result.idempotency_preserved, true);
  assert.equal(result.approved_payment_id, result.replay_payment_id);
  assert.equal(calls.length, 6);

  const approvedTokenBody = JSON.parse(calls[0].options.body);
  const approvedPaymentBody = JSON.parse(calls[1].options.body);
  const rejectedTokenBody = JSON.parse(calls[4].options.body);

  assert.match(calls[0].url, /^https:\/\/api\.mercadopago\.com\/v1\/card_tokens\?public_key=/);
  assert.equal(approvedTokenBody.cardholder.name, "APRO");
  assert.equal(rejectedTokenBody.cardholder.name, "OTHE");
  assert.equal(approvedPaymentBody.installments, 1);
  assert.equal(approvedPaymentBody.payment_method_id, "master");
  assert.equal(calls[1].options.headers["X-Idempotency-Key"], calls[2].options.headers["X-Idempotency-Key"]);
  assert.match(calls[3].url, /\/v1\/payments\/101$/);
});

test("sandbox card probe refuses to run without isolated test credentials", async () => {
  await assert.rejects(
    Probe.probeCardPayments({ accessToken: "test-access-token" }),
    /MERCADO_PAGO_TEST_PUBLIC_KEY/
  );
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
