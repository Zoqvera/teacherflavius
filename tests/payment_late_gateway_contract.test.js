"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const load = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const migration = load("supabase/migrations/20261020164300_late_payment_settlement_gateway.sql");
const recovery = load("supabase/baseline/440_late_payment_settlement_gateway.sql");
const paymentGateway = load("supabase/functions/create-mercado-pago-payment/index.ts");
const checkout = load("pagamento/app.js");
const html = load("pagamento/index.html");

test("production migration and isolated baseline are byte-for-byte identical", () => {
  assert.equal(migration, recovery);
});

test("charge activation is disabled by default and requires explicit deploy flag", () => {
  assert.match(migration, /enabled boolean not null default false/);
  assert.match(migration, /values \(true, false\)/);
  assert.match(migration, /alter table private\.late_payment_charge_settings enable row level security/i);
  assert.match(paymentGateway, /Deno\.env\.get\("LATE_PAYMENT_GATEWAY_ENABLED"\) === "true"/);
  assert.match(paymentGateway, /quote\.billing_enabled === true/);
});

test("frozen attempt stores exact principal, fine, interest and version", () => {
  assert.match(migration, /late_principal_amount numeric\(12,2\)/);
  assert.match(migration, /late_fine_amount numeric\(12,2\)/);
  assert.match(migration, /late_interest_amount numeric\(12,2\)/);
  assert.match(migration, /tuition_payment_attempt_late_breakdown_check/);
  assert.match(migration, /late_fine_amount is not null/);
  assert.match(migration, /round\(amount, 2\) = round\(/);
  assert.match(paymentGateway, /if \(!sameAttempt && Deno\.env\.get/);
  assert.match(paymentGateway, /let paymentAmount = sameAttempt \? Number\(sameAttempt\.amount\) : amount/);
  assert.match(paymentGateway, /late_principal_amount: quotedPrincipal/);
  assert.match(paymentGateway, /late_fine_amount: quotedFine/);
  assert.match(paymentGateway, /late_interest_amount: quotedInterest/);
  assert.match(paymentGateway, /transaction_amount: paymentAmount/);
});

test("gateway independently verifies the authorized amount and rejects stale totals", () => {
  assert.match(paymentGateway, /const quoteResult = await supabaseAdmin\.rpc\("get_checkout_late_tuition_quote"/);
  assert.match(paymentGateway, /quotedPrincipal === amount/);
  assert.match(paymentGateway, /Math\.abs\(expectedAmount - quotedTotal\) >= 0\.005/);
  assert.match(paymentGateway, /late_quote_expired/);
  assert.match(paymentGateway, /if \(sameAttempt\?\.provider_payment_id\)/);
  assert.match(paymentGateway, /localDate\(startedAt\) !== localDate\(new Date\(\)\)/);
  assert.match(paymentGateway, /if \(activeAttempt\?\.provider_payment_id\)/);
  assert.match(paymentGateway, /is_first_tuition_payment_closed/);
  assert.match(checkout, /expected_amount: payableTuitionAmount\(selectedTuition\)/);
});

test("settlement validates principal independently of immutable transaction total", () => {
  assert.match(migration, /round\(target_amount, 2\) is distinct from round\(attempt_row\.amount, 2\)/);
  assert.match(migration, /coalesce\(attempt_row\.late_principal_amount, target_amount\)/);
  assert.match(migration, /late_policy_version is distinct from '2026-10-20-v1'/);
  assert.match(migration, /late_fine_paid = coalesce\(attempt_row\.late_fine_amount, 0\)/);
  assert.match(migration, /late_interest_paid = coalesce\(attempt_row\.late_interest_amount, 0\)/);
  assert.match(migration, /'principal_paid', coalesce\(attempt_row\.late_principal_amount/);
  assert.ok((migration.match(/late_fine_paid = null/g) || []).length >= 2);
  assert.ok((migration.match(/late_interest_paid = null/g) || []).length >= 2);
});

test("students see itemized charges before Mercado Pago is created", () => {
  assert.match(html, /id="checkoutLateBreakdown"/);
  assert.match(html, /id="latePrincipalAmount"/);
  assert.match(html, /id="lateFineAmount"/);
  assert.match(html, /id="lateInterestAmount"/);
  assert.match(html, /id="lateTotalAmount"/);
  assert.match(checkout, /await refreshSelectedLateQuote\(\)/);
  assert.match(checkout, /initialization: \{\s*amount: payableTuitionAmount\(selectedTuition\)/);
  assert.match(html, /noindex, nofollow/);
});

test("private configuration and checkout RPC do not expose their writes to students", () => {
  assert.match(migration, /revoke all on private\.late_payment_charge_settings from public, anon, authenticated/);
  assert.match(migration, /revoke all on function public\.get_checkout_late_tuition_quote\(uuid\)/);
  assert.match(migration, /grant execute on function public\.get_checkout_late_tuition_quote\(uuid\)\s+to service_role/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition\s+set amount_due/i);
});

test("canonical bootstrap includes the gateway overlay and new financial columns", () => {
  const workflow = load(".github/workflows/validate-supabase-baseline.yml");
  const fp = JSON.parse(load("supabase/baseline/schema-fingerprint.json"));
  assert.match(workflow, /440_late_payment_settlement_gateway\.sql/);
  assert.equal(fp.public_functions, 197);
  assert.equal(fp.private_functions, 39);
  assert.equal(fp.constraints, 280);
});
