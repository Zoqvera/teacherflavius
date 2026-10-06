const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const paymentApp = read("pagamento/app.js");
const paymentPage = read("pagamento/index.html");
const paymentFunction = read(
  "supabase/functions/create-mercado-pago-payment/index.ts",
);
const subscriptionFunction = read(
  "supabase/functions/create-mercado-pago-subscription/index.ts",
);
const studentNotice = read("student_payment_notice_renderer.js");

test("Payment Brick offers only Pix and debit card", () => {
  assert.match(paymentApp, /bankTransfer:\s*"all"/);
  assert.match(paymentApp, /debitCard:\s*"all"/);
  assert.doesNotMatch(paymentApp, /creditCard:\s*"all"/);
  assert.doesNotMatch(paymentApp, /prepaidCard:\s*"all"/);
});

test("payment backend rejects credit-card selections before provider creation", () => {
  assert.match(paymentFunction, /selectedPaymentMethod === "debit_card"/);
  assert.doesNotMatch(paymentFunction, /selectedPaymentMethod === "credit_card"/);
  assert.match(paymentFunction, /credit_card_not_allowed/);
  assert.match(paymentFunction, /isDebitCardPaymentMethod/);
  assert.match(paymentFunction, /https:\/\/api\.mercadopago\.com\/v1\/payment_methods/);
  assert.match(paymentFunction, /payment_type_id[\s\S]*"debit_card"/);
});

test("recurring card checkout is not exposed and new subscriptions are disabled", () => {
  assert.doesNotMatch(paymentPage, /subscription_checkout\.js/);
  assert.doesNotMatch(paymentPage, /id="subscriptionOffer"/);
  assert.match(
    subscriptionFunction,
    /function subscriptionsEnabled\(\): boolean \{\s*return false;\s*\}/,
  );
});

test("student-facing payment copy says Pix or debit card", () => {
  assert.match(paymentPage, /Pague com Pix ou cartão de débito/);
  assert.match(paymentApp, /Escolha Pix ou cartão de débito/);
  assert.match(studentNotice, /Pix ou cartão de débito/);
});
