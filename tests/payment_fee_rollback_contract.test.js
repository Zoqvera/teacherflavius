const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const gateway = fs.readFileSync(
  'supabase/functions/create-mercado-pago-payment/index.ts',
  'utf8'
);

test('ordinary tuition payment preserves its server-side original amount', () => {
  assert.match(gateway, /const amount = Number\(tuition\.amount_due\)/);
  assert.match(gateway, /!sponsoredPayment && chargeAmount !== amount/);
  assert.doesNotMatch(gateway, /LATE_PAYMENT_GATEWAY_ENABLED/);
});

test('sponsored payment uses the immutable server-quoted total', () => {
  assert.match(gateway, /const chargeAmount = Number\(financialQuote\.total\)/);
  assert.match(gateway, /transaction_amount: chargeAmount/);
  assert.match(gateway, /amount: chargeAmount/);
  assert.match(gateway, /reserve_financial_responsibility_payment/);
  assert.doesNotMatch(gateway, /amount:\s*body\.amount/);
});
