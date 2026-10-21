const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

test('payment uses the original amount', () => {
  const gateway = fs.readFileSync('supabase/functions/create-mercado-pago-payment/index.ts', 'utf8');
  assert.match(gateway, /transaction_amount: amount/);
  assert.doesNotMatch(gateway, /LATE_PAYMENT_GATEWAY_ENABLED/);
});
