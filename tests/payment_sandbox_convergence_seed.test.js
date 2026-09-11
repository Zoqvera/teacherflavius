const test = require("node:test");
const assert = require("node:assert/strict");
const Seed = require("../scripts/mercado_pago_sandbox_seed.js");

function baseSettings(overrides) {
  return {
    accessToken: "test-access-token",
    publicKey: "test-public-key",
    payerEmail: "sandbox@example.test",
    paymentMethodId: "master",
    amount: 10,
    externalReference: "sandbox-card-convergence-123",
    card: {
      number: "test-card-number",
      securityCode: "123",
      expirationMonth: 11,
      expirationYear: 2030
    },
    randomUuid: function () { return "11111111-1111-4111-8111-111111111111"; },
    ...overrides
  };
}

test("creates exactly one approved sandbox payment with the requested external reference", async () => {
  const calls = [];
  const probe = {
    async createCardToken(options) {
      calls.push({ phase: "token", options });
      return "approved-card-token";
    },
    async createPayment(options) {
      calls.push({ phase: "payment", options });
      return { id: 303, status: "approved" };
    },
    async getPayment(options) {
      calls.push({ phase: "lookup", options });
      return {
        id: 303,
        status: "approved",
        external_reference: "sandbox-card-convergence-123",
        live_mode: false
      };
    }
  };

  const result = await Seed.seedApprovedPayment(baseSettings({ probe }));

  assert.equal(result.ok, true);
  assert.equal(result.external_reference, "sandbox-card-convergence-123");
  assert.equal(result.payment_id, "303");
  assert.equal(result.status, "approved");
  assert.equal(result.live_mode, false);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.holderName, "APRO");
  assert.equal(calls[1].options.idempotencyKey, "11111111-1111-4111-8111-111111111111");
  assert.equal(calls[1].options.payload.external_reference, "sandbox-card-convergence-123");
  assert.equal(calls[1].options.payload.transaction_amount, 10);
  assert.equal(calls[1].options.payload.installments, 1);
  assert.equal(calls[1].options.payload.payment_method_id, "master");
  assert.equal(calls[2].options.paymentId, 303);
});

test("refuses to seed a payment outside the sandbox reference namespace", async () => {
  await assert.rejects(
    Seed.seedApprovedPayment(baseSettings({
      externalReference: "production-looking-reference",
      probe: {}
    })),
    /sandbox-card-/
  );
});

test("fails closed when payment lookup is not explicitly sandbox live_mode false", async () => {
  const probe = {
    async createCardToken() {
      return "approved-card-token";
    },
    async createPayment() {
      return { id: 404, status: "approved" };
    },
    async getPayment() {
      return {
        id: 404,
        status: "approved",
        external_reference: "sandbox-card-convergence-123",
        live_mode: true
      };
    }
  };

  await assert.rejects(
    Seed.seedApprovedPayment(baseSettings({ probe })),
    /isolated approved payment/
  );
});
