const test = require("node:test");
const assert = require("node:assert/strict");
const PaymentIdempotency = require("../pagamento/payment_idempotency.js");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); },
    removeItem(key) { values.delete(key); },
  };
}

const FIRST_UUID = "11111111-1111-4111-8111-111111111111";
const SECOND_UUID = "22222222-2222-4222-8222-222222222222";

test("reuses the same idempotency key for the same user and tuition", () => {
  const storage = createStorage();
  const first = PaymentIdempotency.getOrCreate(storage, "user-a", "tuition-a", () => FIRST_UUID);
  const second = PaymentIdempotency.getOrCreate(storage, "user-a", "tuition-a", () => SECOND_UUID);

  assert.equal(first, FIRST_UUID);
  assert.equal(second, FIRST_UUID);
});

test("keeps idempotency keys isolated by user and tuition", () => {
  const storage = createStorage();
  PaymentIdempotency.getOrCreate(storage, "user-a", "tuition-a", () => FIRST_UUID);
  const second = PaymentIdempotency.getOrCreate(storage, "user-a", "tuition-b", () => SECOND_UUID);

  assert.equal(second, SECOND_UUID);
  assert.equal(PaymentIdempotency.load(storage, "user-a", "tuition-a"), FIRST_UUID);
  assert.equal(PaymentIdempotency.load(storage, "user-a", "tuition-b"), SECOND_UUID);
});

test("clears a persisted key only when explicitly requested", () => {
  const storage = createStorage();
  PaymentIdempotency.getOrCreate(storage, "user-a", "tuition-a", () => FIRST_UUID);
  PaymentIdempotency.clear(storage, "user-a", "tuition-a");

  assert.equal(PaymentIdempotency.load(storage, "user-a", "tuition-a"), null);
});

test("preserves the key after ambiguous server or network failures", () => {
  assert.equal(PaymentIdempotency.shouldClearAfterFailure({ status: 500, code: "" }), false);
  assert.equal(PaymentIdempotency.shouldClearAfterFailure({ status: null, code: "" }), false);
});

test("clears the key after deterministic client or gateway configuration failures", () => {
  assert.equal(PaymentIdempotency.shouldClearAfterFailure({ status: 422, code: "provider_rejected_payment" }), true);
  assert.equal(PaymentIdempotency.shouldClearAfterFailure({ status: 409, code: "already_paid" }), true);
  assert.equal(PaymentIdempotency.shouldClearAfterFailure({ status: 503, code: "mercado_pago_pix_temporarily_unavailable" }), true);
});
