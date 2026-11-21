const { test } = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../supabase/functions/_shared/record_authenticated_tuition_payment.mjs");
const payment = {
  tuitionId: "11111111-1111-4111-8111-111111111111",
  paymentDate: "2026-11-04",
  amountPaid: 50,
  paymentMethod: "pix",
};

test("encaminha o pagamento com a sessão verificada à rotina financeira", async () => {
  const { recordAuthenticatedTuitionPayment } = await load();
  let args;
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "professor" } } }) },
    rpc: async (name, payload) => { args = { name, payload }; return { data: { ok: true } }; },
  };
  assert.deepEqual(await recordAuthenticatedTuitionPayment(client, payment), { ok: true });
  assert.equal(args.name, "record_tuition_payment");
  assert.deepEqual(args.payload, {
    target_tuition_id: payment.tuitionId,
    target_payment_date: payment.paymentDate,
    target_amount_paid: 50,
    target_payment_method: "pix",
    target_payment_notes: null,
  });
});

test("rejeita sessão inválida sem chamar a rotina financeira", async () => {
  const { recordAuthenticatedTuitionPayment } = await load();
  const client = { auth: { getUser: async () => ({ data: { user: null } }) }, rpc: () => assert.fail("RPC chamada") };
  await assert.rejects(recordAuthenticatedTuitionPayment(client, payment), /Sessão/);
});

test("impede dados inválidos e preserva a recusa da rotina financeira", async () => {
  const { recordAuthenticatedTuitionPayment } = await load();
  let calls = 0;
  const denied = new Error("Acesso negado");
  const client = { auth: { getUser: async () => ({ data: { user: { id: "aluno" } } }) }, rpc: async () => { calls++; return { error: denied }; } };
  for (const input of [{ ...payment, paymentDate: "2026-02-30" }, { ...payment, amountPaid: 50.001 }, { ...payment, paymentMethod: "invalid" }]) {
    await assert.rejects(recordAuthenticatedTuitionPayment(client, input));
  }
  assert.equal(calls, 0);
  await assert.rejects(recordAuthenticatedTuitionPayment(client, payment), error => error === denied);
  assert.equal(calls, 1);
});
