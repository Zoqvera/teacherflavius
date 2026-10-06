const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const historicalStrictCancellation = read(
  "supabase/migrations/20261006013809_enforce_12h_lesson_cancellation.sql",
);
const canonicalCancellation = read(
  "supabase/migrations/20261006024346_unify_lesson_cancellation_policy.sql",
);
const driftScript = read("scripts/check_supabase_migration_drift.sh");
const driftWorkflow = read(".github/workflows/supabase-migration-drift.yml");
const baselineWorkflow = read(".github/workflows/validate-supabase-baseline.yml");
const tuitionBaseline = read(
  "supabase/baseline/130_enforce_tuition_after_enrollment.sql",
);

test("the production-only strict cancellation migration is preserved in Git", () => {
  assert.match(
    historicalStrictCancellation,
    /now\(\) > credit_row\.regular_starts_at - interval '12 hours'/i,
  );
  assert.match(
    historicalStrictCancellation,
    /O prazo para cancelamento terminou 12 horas antes da aula/i,
  );
});

test("the later canonical migration supersedes the strict 12-hour rule", () => {
  assert.match(
    canonicalCancellation,
    /create or replace function private\.lesson_can_be_cancelled/i,
  );
  assert.match(
    canonicalCancellation,
    /evaluated_at < target_starts_at/i,
  );
  assert.match(
    canonicalCancellation,
    /evaluated_at <= target_starts_at - interval '12 hours'/i,
  );
  assert.doesNotMatch(
    canonicalCancellation,
    /O prazo para cancelamento terminou 12 horas antes da aula/i,
  );
});

test("CI compares production migration history with committed migrations", () => {
  assert.match(driftScript, /supabase_migrations\.schema_migrations/i);
  assert.match(driftScript, /comm -23/);
  assert.match(driftScript, /comm -13/);
  assert.match(driftScript, /MIGRATION_DRIFT_CUTOFF/);
  assert.match(driftWorkflow, /SUPABASE_DB_URL/);
  assert.match(
    driftWorkflow,
    /bash scripts\/check_supabase_migration_drift\.sh/,
  );
});

test("baseline reconstruction applies the canonical cancellation policy", () => {
  assert.match(
    baselineWorkflow,
    /supabase\/baseline\/230_unify_lesson_cancellation_policy\.sql/,
  );
});

test("baseline reconstructs tuition exemption fields required by later overlays", () => {
  assert.match(tuitionBaseline, /add column if not exists is_exempt boolean not null default false/i);
  assert.match(tuitionBaseline, /add column if not exists exempted_at timestamptz/i);
  assert.match(tuitionBaseline, /add column if not exists exemption_notes text/i);
});
