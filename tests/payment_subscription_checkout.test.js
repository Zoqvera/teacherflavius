const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("pagamento/index.html");
const checkout = read("pagamento/subscription_checkout.js");
const functionSource = read(
  "supabase/functions/create-mercado-pago-subscription/index.ts",
);

test("payment page exposes a feature-gated monthly subscription area", () => {
  assert.match(page, /id="subscriptionOffer"/);
  assert.match(page, /id="subscriptionAmount"/);
  assert.match(page, /id="subscriptionDueDay"/);
  assert.match(page, /id="subscriptionFirstCharge"/);
  assert.match(page, /id="subscriptionCardBrickContainer"/);
  assert.match(page, /subscription_checkout\.js/);
});

test("subscription checkout uses Mercado Pago Card Payment Brick for tokenization", () => {
  assert.match(checkout, /\.create\(\s*"cardPayment"/);
  assert.match(checkout, /formData && formData\.token/);
  assert.match(checkout, /card_token_id: cardTokenId/);
  assert.match(checkout, /excluded: \["debit_card", "prepaid_card"\]/);
  assert.match(checkout, /cardBrickController\.unmount\(\)/);
});

test("browser never forwards raw card fields to the application backend", () => {
  assert.doesNotMatch(checkout, /cardNumber|securityCode|expirationDate|expirationMonth|expirationYear|cvv/i);
  assert.doesNotMatch(checkout, /payment_data\s*:/i);
  assert.doesNotMatch(checkout, /formData\.payer/i);
});

test("subscription option stays hidden while creation is unavailable", () => {
  assert.match(
    checkout,
    /if \(!current && !available\) \{\s*hideSubscriptionSection\(\)/,
  );
  assert.match(checkout, /preview\.subscriptions_enabled === true/);
  assert.match(checkout, /!!preview\.public_key/);
});

test("subscription preview exposes only a gated Mercado Pago public key", () => {
  assert.match(functionSource, /MERCADO_PAGO_PUBLIC_KEY/);
  assert.match(
    functionSource,
    /const subscriptionCheckoutEnabled = subscriptionsEnabled\(\)[\s\S]*!!mercadoPagoAccessToken[\s\S]*!!mercadoPagoPublicKey/,
  );
  assert.match(
    functionSource,
    /public_key: subscriptionCheckoutEnabled \? mercadoPagoPublicKey : null/,
  );
  assert.match(functionSource, /subscriptions_not_enabled/);
});

test("new subscription checkout site assets respect project copy constraints", () => {
  assert.doesNotMatch(page, /\bonline\b/i);
  assert.doesNotMatch(checkout, /\bonline\b/i);
});
