const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const history = require("../pagamento/tuition_history.js");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migrationPath = "supabase/migrations/20261008052515_student_paid_tuition_history.sql";
const baselinePath = "supabase/baseline/355_student_paid_tuition_history.sql";
const migration = read(migrationPath);
const html = read("pagamento/index.html");
const paymentApp = read("pagamento/app.js");
const historyScript = read("pagamento/tuition_history.js");

test("returns exactly one record per monthly tuition, scoped to the signed-in user", function () {
  assert.equal(migration, read(baselinePath));
  assert.match(migration, /create or replace function public\.get_my_paid_tuition_history\(\)/i);
  assert.match(migration, /language sql\s+stable\s+security definer\s+set search_path = ''/i);
  assert.match(migration, /tuition\.student_id = auth\.uid\(\)/i);
  assert.match(migration, /from public\.monthly_tuition tuition/i);
  assert.doesNotMatch(migration, /from public\.tuition_payment_attempts/i);
  assert.match(migration, /tuition\.payment_date is not null/i);
  assert.match(migration, /tuition\.amount_paid > 0/i);
  assert.match(migration, /not coalesce\(tuition\.is_exempt, false\)/i);
  assert.match(migration, /when tuition\.amount_paid >= tuition\.amount_due then 'paid'/i);
  assert.match(migration, /else 'partial'/i);
  assert.match(migration, /order by tuition\.reference_month desc/i);
});

test("permits only authenticated calls and never returns student identifiers", function () {
  assert.match(migration, /revoke all on function public\.get_my_paid_tuition_history\(\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_my_paid_tuition_history\(\)\s+to authenticated, service_role/i);
  const output = migration.match(/returns table\s*\(([\s\S]*?)\)/i);
  assert.ok(output);
  assert.doesNotMatch(output[1], /student_id|payment_notes|provider_payment_id|cpf/i);
  assert.match(output[1], /payment_date date/i);
  assert.match(output[1], /amount_paid numeric/i);
});

test("renders a collapsible history in both open and fully-paid payment states", function () {
  const success = html.indexOf('id="paymentSuccess"');
  const historyCard = html.indexOf('id="tuitionHistorySection"');
  const help = html.indexOf('class="payment-help"');
  assert.ok(success > 0 && historyCard > success && help > historyCard);
  assert.match(html, /id="tuitionHistoryToggle"[^>]*aria-expanded="false"[^>]*aria-controls="tuitionHistoryPanel"/i);
  assert.match(html, /id="tuitionHistoryPanel"[^>]*hidden/);
  assert.match(html, /<strong>HISTÓRICO<\/strong>/);
  assert.match(html, /tuition_history\.js\?v=20261008-1/);
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(paymentApp, /TuitionHistory\.mount/);
  assert.match(paymentApp, /TuitionHistory\.refreshIfOpen/);
  assert.match(historyScript, /client\.rpc\(HISTORY_RPC\)/);
  assert.match(historyScript, /document\.createElement/);
  assert.match(historyScript, /textContent = content/);
  assert.doesNotMatch(historyScript, /innerHTML\s*=/);
});

test("keeps historical and partial payments while filtering invalid records", function () {
  const records = history.normalizeRecords([
    { reference_month: "2026-06-01", payment_date: "2026-06-12", amount_paid: 50, payment_status: "paid" },
    { reference_month: "2026-08-01", payment_date: "2026-08-05", amount_paid: 40, payment_status: "partial" },
    { reference_month: "2026-07-01", payment_date: null, amount_paid: 50, payment_status: "paid" },
    { reference_month: "2026-09-01", payment_date: "2026-09-05", amount_paid: 0, payment_status: "paid" }
  ]);
  assert.deepEqual(records.map(function (item) { return item.reference_month; }), [
    "2026-08-01", "2026-06-01"
  ]);
  assert.equal(records[0].payment_status, "partial");
});

test("formats Brazilian amounts and dates without assuming Mercado Pago", function () {
  assert.match(history.formatCurrency(50), /^R\\$\\s50,00$/);
  assert.equal(history.formatDate("2026-09-07"), "07/09/2026");
  assert.equal(history.paymentMethodLabel("pix"), "Pix");
  assert.equal(history.paymentMethodLabel("cash"), "Dinheiro");
  assert.equal(history.paymentMethodLabel("bank_transfer"), "Transferência bancária");
  assert.equal(history.paymentMethodLabel("card"), "Cartão");
});
