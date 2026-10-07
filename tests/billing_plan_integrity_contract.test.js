const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261007034238_normalize_billing_plans_and_legacy_settings.sql"
);
const baseline = read(
  "supabase/baseline/325_normalize_billing_plans_and_legacy_settings.sql"
);

for (const sql of [migration, baseline]) {
  test("billing plans are canonical and server-side", function () {
    assert.match(sql, /create table if not exists private\.billing_plans/i);
    assert.match(sql, /revoke all on table private\.billing_plans from public, anon, authenticated/i);
    assert.match(sql, /add column if not exists billing_plan_id uuid/i);
    assert.match(sql, /references private\.billing_plans\(id\)/i);
    assert.match(sql, /create trigger enforce_student_billing_plan_before_write/i);
  });

  test("known historical gaps are repaired without replaying lesson-credit side effects", function () {
    assert.match(sql, /disable trigger sync_lesson_credits_after_plan_change/i);
    assert.match(sql, /round\(settings\.monthly_fee, 2\) in \(99\.90, 250\.00\)/i);
    assert.match(sql, /set classes_per_month = 4/i);
    assert.match(sql, /enable trigger sync_lesson_credits_after_plan_change/i);
  });

  test("ambiguous legacy rows are isolated for review instead of guessed", function () {
    assert.match(sql, /plan_review_required = true/i);
    assert.match(sql, /coalesce\(profile\.archived, false\) = true/i);
    assert.match(sql, /settings\.active = false/i);
    assert.match(sql, /Somente registros históricos arquivados e inativos/i);
  });

  test("new writes must resolve to a valid plan", function () {
    assert.match(sql, /A combinação de mensalidade e quantidade de aulas não corresponde a um plano financeiro válido/i);
    assert.match(sql, /student_billing_settings_plan_state_check/i);
    assert.match(sql, /billing_plan_id is not null/i);
    assert.match(sql, /classes_per_month is not null/i);
  });

  test("fee-only lesson derivation is retired", function () {
    assert.match(
      sql,
      /drop function if exists private\.enrollment_classes_per_month_for_fee\(numeric\)/i
    );
  });
}
