const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const overlayPath = "supabase/baseline/375_preserve_historical_credits_and_profile_integrity.sql";
const migrationPath = "supabase/migrations/20261013012100_preserve_historical_credits_and_profile_integrity.sql";
const overlay = fs.readFileSync(path.join(root, overlayPath), "utf8");
const migration = fs.readFileSync(path.join(root, migrationPath), "utf8");
const auditPanel = fs.readFileSync(path.join(root, "lesson_credit_admin.js"), "utf8");
const baselineWorkflow = fs.readFileSync(
  path.join(root, ".github/workflows/validate-supabase-baseline.yml"), "utf8"
);

test("migration and disaster-recovery overlay use the same schema contract", () => {
  assert.equal(migration, overlay);
  assert.match(overlay, /create table if not exists private\.lesson_credit_plan_exceptions/i);
  assert.match(overlay, /approval_reason text not null/i);
  assert.match(overlay, /enable row level security/i);
  assert.match(overlay, /revoke all on private\.lesson_credit_plan_exceptions from public, anon, authenticated/i);
  assert.doesNotMatch(overlay, /09e9907a-b64a-4ef6-9b60-cf6f384415b4/i);
  assert.doesNotMatch(overlay, /Isabela Alves/i);
});

test("approved paid historic credits are not mistaken for unreviewed excess", () => {
  const approved = overlay.indexOf("then 'approved_historical_exception'");
  const excess = overlay.indexOf("then 'active_excess'");
  const unpaid = overlay.indexOf("then 'active_unpaid'");

  assert.ok(unpaid >= 0 && unpaid < approved && approved < excess);
  assert.match(overlay, /approved\.credit_id is not null/);
  assert.match(overlay, /approved_historical_exception', totals\.approved_historical_exception/);
  assert.match(overlay, /approved\.approval_reason/);
  assert.match(auditPanel, /Créditos históricos justificados/);
  assert.match(auditPanel, /approved_historical_exception/);
});

test("tuition synchronization preserves approved credits but revokes unpaid credits", () => {
  const unpaidBranch = overlay.indexOf("if tuition_row.payment_date is null");
  const excessBranch = overlay.indexOf("when credit.credit_number > contracted_count");

  assert.ok(unpaidBranch >= 0 && unpaidBranch < excessBranch);
  assert.match(overlay, /where approved\.credit_id = credit\.id/g);
  assert.equal(
    (overlay.match(/where approved\.credit_id = credit\.id/g) || []).length,
    2
  );
  assert.match(overlay, /when credit\.credit_number > contracted_count\s+and not exists/i);
});

test("missing-profile class memberships are monitored without recreating profiles", () => {
  assert.match(overlay, /left join public\.profiles profile on profile\.id = cs\.user_id/i);
  assert.match(overlay, /data_quality_class_membership_without_profile/);
  assert.match(overlay, /'class_memberships_without_profile',class_memberships_without_profile/);
  assert.doesNotMatch(overlay, /insert into public\.profiles/i);
});

test("new overlay is included in the real disposable baseline restore", () => {
  assert.match(baselineWorkflow, /375_preserve_historical_credits_and_profile_integrity\.sql/);
});
