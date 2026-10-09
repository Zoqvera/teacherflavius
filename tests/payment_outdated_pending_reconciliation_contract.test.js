const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20261009165200_reconcile_unapproved_outdated_payment_attempts.sql"
  ),
  "utf8"
);

test("reconciles a pending Pix against its original attempt even when the plan changes", () => {
  assert.match(source, /round\(target_amount, 2\) is distinct from round\(attempt_row\.amount, 2\)/);
  assert.match(source, /normalized_status = 'approved'\s+and round\(target_amount, 2\) is distinct from round\(tuition_row\.amount_due, 2\)/);
  assert.match(source, /and not split_is_valid/);
  assert.match(source, /status = normalized_status/);
  assert.match(source, /reconciliation_failure_count = 0/);
});

test("a late approved Pix for an outdated plan cannot settle the new tuition amount", () => {
  assert.match(source, /if normalized_status = 'approved' then/);
  assert.match(source, /raise exception 'O valor confirmado não corresponde à mensalidade\.'/);
  assert.match(source, /where id = tuition_row\.id\s+and payment_date is null/);
  assert.match(source, /duplicate_payment_detected/);
});

test("refund and chargeback support remains available after an amount change", () => {
  assert.match(source, /elsif normalized_status in \('cancelled', 'refunded', 'charged_back'\)/);
  assert.match(source, /private\.mercado_pago_tuition_allocations/);
  assert.match(source, /payment_was_reversed/);
});
