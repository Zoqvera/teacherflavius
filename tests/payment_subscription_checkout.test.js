const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("pagamento/index.html");
const functionSource = read(
  "supabase/functions/create-mercado-pago-subscription/index.ts",
);

test("payment page does not expose recurring card subscription checkout", () => {
  assert.doesNotMatch(page, /id="subscriptionOffer"/);
  assert.doesNotMatch(page, /id="subscriptionCardBrickContainer"/);
  assert.doesNotMatch(page, /subscription_checkout\.js/);
});

test("new recurring subscriptions stay disabled server-side", () => {
  assert.match(
    functionSource,
    /function subscriptionsEnabled\(\): boolean \{\s*return false;\s*\}/,
  );
  assert.match(functionSource, /subscriptions_not_enabled/);
});

test("subscription history infrastructure remains available for reconciliation", () => {
  assert.match(functionSource, /https:\/\/api\.mercadopago\.com\/preapproval/);
  assert.match(functionSource, /external_reference: subscription\.external_reference/);
});

test("payment page respects project copy constraints", () => {
  assert.doesNotMatch(page, /\bonline\b/i);
});
