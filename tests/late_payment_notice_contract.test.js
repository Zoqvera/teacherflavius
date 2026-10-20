"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const checkoutHtml = fs.readFileSync(path.join(ROOT, "pagamento/index.html"), "utf8");
const checkoutStyles = fs.readFileSync(path.join(ROOT, "pagamento/style.css"), "utf8");

test("checkout transparently discloses conditional late payment charges", () => {
  assert.match(checkoutHtml, /id="latePaymentNoticeTitle"/);
  assert.match(checkoutHtml, /pagamentos em atraso/i);
  assert.match(checkoutHtml, /multa moratória de <strong>2% uma única vez<\/strong>/);
  assert.match(checkoutHtml, /juros simples de <strong>1% ao mês<\/strong>/);
  assert.match(checkoutHtml, /Quando previstos nas condições aplicáveis à contratação/);
  assert.match(checkoutHtml, /discriminados antes da confirmação do pagamento/);
});

test("late fee notice remains accessible and styled without modifying checkout indexing", () => {
  assert.match(checkoutHtml, /<aside class="late-payment-notice" aria-labelledby="latePaymentNoticeTitle">/);
  assert.match(checkoutStyles, /\.late-payment-notice\s*\{/);
  assert.match(checkoutHtml, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(checkoutHtml, /id="paymentBrickContainer"/);
});
