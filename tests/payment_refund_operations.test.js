const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const RefundOperations = require("../payment_refund_operations.js");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read("supabase/migrations/20260909213850_add_safe_mercado_pago_refunds.sql");
const edgeFunction = read("supabase/functions/refund-mercado-pago-payment/index.ts");

test("uses explicit refund labels for provider state", () => {
  assert.equal(RefundOperations.labelForRefundStatus(""), "REEMBOLSAR");
  assert.equal(RefundOperations.labelForRefundStatus("failed"), "TENTAR REEMBOLSO");
  assert.equal(RefundOperations.labelForRefundStatus("processing"), "VERIFICAR REEMBOLSO");
  assert.equal(RefundOperations.labelForRefundStatus("provider_accepted"), "VERIFICAR REEMBOLSO");
});

test("normalizes refundable tuition rows without exposing provider ids to button decorators", () => {
  const candidates = RefundOperations.normalizeCandidates([
    { tuition_id: "tuition-1", amount_paid: "99.90", refund_status: "failed" },
    { tuition_id: "tuition-2", amount_paid: 120, refund_status: null }
  ]);

  assert.equal(candidates.size, 2);
  assert.deepEqual(candidates.get("tuition-1"), {
    tuitionId: "tuition-1",
    status: "failed",
    amount: 99.9
  });
});

test("decorates only Mercado Pago reverse buttons", () => {
  const providerButton = {
    dataset: { action: "reverse", tuitionId: "tuition-1" },
    textContent: "ESTORNAR",
    title: "",
    setAttribute(name, value) { this[name] = value; }
  };
  const documentRef = {
    querySelectorAll() { return [providerButton]; }
  };
  const candidates = new Map([
    ["tuition-1", { tuitionId: "tuition-1", status: "", amount: 99.9 }]
  ]);

  assert.equal(RefundOperations.decorateButtons(documentRef, candidates), 1);
  assert.equal(providerButton.dataset.action, RefundOperations.REFUND_ACTION);
  assert.equal(providerButton.textContent, "REEMBOLSAR");
  assert.equal(providerButton["aria-label"], "Reembolsar integralmente o pagamento pelo Mercado Pago");
});

test("database blocks local reversal for gateway-confirmed payments", () => {
  assert.match(migration, /payment_refund_requests_provider_payment_id_key unique/);
  assert.match(migration, /payment_refund_requests_idempotency_key_key unique/);
  assert.match(migration, /status in \('created','processing','provider_accepted','synchronized','failed'\)/);
  assert.match(migration, /Pagamentos confirmados por gateway devem ser reembolsados no provedor/);
  assert.match(migration, /get_teacher_mercado_pago_refund_candidates/);
  assert.match(migration, /is_teacher_admin_mfa\(\)/);
});

test("refund endpoint requires MFA and a deliberate confirmation", () => {
  assert.match(edgeFunction, /is_teacher_admin_mfa/);
  assert.match(edgeFunction, /REFUND_CONFIRMATION = "REEMBOLSAR"/);
  assert.match(edgeFunction, /begin_mercado_pago_refund/);
  assert.match(edgeFunction, /finish_mercado_pago_refund/);
});

test("refund endpoint performs only a full idempotent provider refund", () => {
  assert.match(edgeFunction, /\/v1\/payments\/\$\{encodeURIComponent\(paymentId\)\}\/refunds/);
  assert.match(edgeFunction, /"X-Idempotency-Key": idempotencyKey/);
  assert.match(edgeFunction, /method: "POST"/);
  assert.doesNotMatch(edgeFunction, /body:\s*JSON\.stringify\(\{\s*amount/);
});

test("refund endpoint reconciles provider state before and after refund", () => {
  assert.match(edgeFunction, /synchronizeMercadoPagoPayment/);
  assert.match(edgeFunction, /skip_provider_call/);
  assert.match(edgeFunction, /awaiting_provider_state/);
  assert.match(edgeFunction, /record_mercado_pago_reconciliation_failure/);
});
