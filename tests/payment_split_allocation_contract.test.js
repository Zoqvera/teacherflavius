const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (name) => fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8');
const ledger = read('20261009015000_support_mercado_pago_split_allocations.sql');
const processor = read('20261009015100_reconcile_mercado_pago_allocations.sql');
const health = read('20261009015200_validate_allocated_payment_health.sql');
test('allocated payments remain auditable and amounts match the provider', () => {
 assert.match(ledger, /sum\(allocation\.allocated_amount\)/);
 assert.match(ledger, /tuition\.student_id = attempt\.student_id/);
 assert.match(ledger, /unique \(tuition_id\)/);
 assert.match(processor, /split_is_valid/);
 assert.match(processor, /rateio não pôde ser revertido integralmente/);
 assert.match(health, /has_valid_mercado_pago_split/);
});
