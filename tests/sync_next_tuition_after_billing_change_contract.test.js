const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261021163103_sync_next_tuition_after_billing_change.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(root, "supabase/baseline/450_sync_next_tuition_after_billing_change.sql"),
  "utf8"
);
const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/validate-supabase-baseline.yml"),
  "utf8"
);

test("baseline restore installs the same idempotent billing reconciliation", () => {
  assert.equal(baseline, migration);
  assert.match(workflow, /450_sync_next_tuition_after_billing_change\.sql/);
  assert.match(workflow, /sync_next_tuition_after_billing_change_contract\.test\.js/);
});

test("billing activation and edits recheck the next cycle", () => {
  assert.match(
    migration,
    /after insert or update of active, monthly_fee, due_day, billing_start_month\s+on public\.student_billing_settings/i
  );
  assert.match(migration, /when \(new\.active is true\)/i);
  assert.match(migration, /payment_date is not null/i);
  assert.match(migration, /last_paid_reference_month \+ interval '1 month'/i);
});

test("reconciliation does not generate duplicate or historic invoices", () => {
  assert.match(migration, /next_reference_month < current_reference_month/i);
  assert.match(migration, /existing\.reference_month = next_reference_month/i);
  assert.match(migration, /existing\.due_date = next_due_date/i);
  assert.match(migration, /on conflict do nothing/i);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
  assert.doesNotMatch(migration, /delete from public\.monthly_tuition/i);
});

test("honors inactive, archived, paused, exempt and enrollment constraints", () => {
  assert.match(migration, /new\.active is not true/i);
  assert.match(migration, /profile\.enrolled is true/i);
  assert.match(migration, /profile\.archived is false/i);
  assert.match(migration, /course\.course_status = 'paused'/i);
  assert.match(migration, /course\.billing_exemption = 'permanent'/i);
  assert.match(migration, /next_due_date < enrolled_on/i);
});

test("private trigger function is not directly executable by browsers", () => {
  assert.match(migration, /create or replace function private\./i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.ensure_next_tuition_after_billing_change\(\)/i);
});
