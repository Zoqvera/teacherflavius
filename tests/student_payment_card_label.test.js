const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const studentArea = fs.readFileSync(
  path.join(__dirname, "..", "area_do_estudante.html"),
  "utf8"
);

test("student payment card uses the action-oriented label without a description", function () {
  const paymentCardMatch = studentArea.match(
    /<a class="menu-button" href="\/pagamento\/">([\s\S]*?)<\/a>/
  );

  assert.ok(paymentCardMatch, "payment card should exist");
  const paymentCard = paymentCardMatch[1];

  assert.match(paymentCard, /PAGAR MENSALIDADE/);
  assert.doesNotMatch(paymentCard, />MENSALIDADES</);
  assert.doesNotMatch(paymentCard, /<small>/);
});
