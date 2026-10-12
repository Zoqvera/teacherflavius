const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = "supabase/migrations/20261012201436_avoid_tuition_due_date_generation_conflicts.sql";
const baselinePath = "supabase/baseline/370_avoid_tuition_due_date_generation_conflicts.sql";

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const migration = read(migrationPath);
const baseline = read(baselinePath);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("production migration and disaster-recovery overlay stay identical", () => {
  assert.equal(baseline, migration);
  assert.match(workflow, /supabase\/baseline\/370_avoid_tuition_due_date_generation_conflicts\.sql/);
});

test("generator refuses a new tuition row when another competency already owns its due date", () => {
  assert.match(
    migration,
    /or not exists \([\s\S]*conflicting_due\.due_date = effective_due\.due_date[\s\S]*conflicting_due\.reference_month <> generated_month\.reference_month::date/
  );
});

test("generator preserves an existing due date instead of violating the unique invariant", () => {
  assert.match(
    migration,
    /due_date = case[\s\S]*conflicting_due\.id <> public\.monthly_tuition\.id[\s\S]*then public\.monthly_tuition\.due_date[\s\S]*else excluded\.due_date/
  );
  assert.match(
    migration,
    /public\.monthly_tuition\.due_date is distinct from excluded\.due_date[\s\S]*and not exists \([\s\S]*conflicting_due\.id <> public\.monthly_tuition\.id/
  );
});
