const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261007035146_resolve_reviewed_legacy_billing_plans.sql"
);
const baseline = read(
  "supabase/baseline/330_add_reviewed_legacy_billing_plan.sql"
);

test("reviewed R$ 300 legacy plan is canonicalized as four lessons", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /legacy_300_4/);
    assert.match(sql, /300\.00/);
    assert.match(sql, /classes_per_month[\s\S]*4/);
    assert.match(sql, /legacy[\s\S]*true/i);
  }
});

test("historical resolution is limited to archived inactive review rows", function () {
  assert.match(migration, /profile\.archived = true/i);
  assert.match(migration, /settings\.active = false/i);
  assert.match(migration, /settings\.plan_review_required = true/i);
  assert.match(migration, /round\(settings\.monthly_fee, 2\) in \(80\.00, 300\.00\)/i);
});

test("historical resolution does not replay lesson-credit synchronization", function () {
  assert.match(migration, /disable trigger sync_lesson_credits_after_plan_change/i);
  assert.match(migration, /enable trigger sync_lesson_credits_after_plan_change/i);
});

test("public baseline contains no student-specific identifiers", function () {
  assert.doesNotMatch(baseline, /public\.profiles/i);
  assert.doesNotMatch(baseline, /student_id/i);
});
