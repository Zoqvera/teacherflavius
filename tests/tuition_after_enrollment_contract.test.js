const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20261002180000_enforce_tuition_after_enrollment.sql"
  ),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/baseline/130_enforce_tuition_after_enrollment.sql"
  ),
  "utf8"
);
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/validate-supabase-baseline.yml"),
  "utf8"
);

test("stores an explicit enrollment timestamp and protects it from student writes", function () {
  assert.match(migration, /add column if not exists enrolled_at timestamptz/);
  assert.match(migration, /create or replace function public\.set_profile_enrolled_at\(\)/);
  assert.match(migration, /new\.enrolled_at := now\(\)/);
  assert.match(migration, /new\.enrolled_at := old\.enrolled_at/);
  assert.match(migration, /where id = 'fa6d29fe-b63f-42da-9673-327debd78079'/);
  assert.match(migration, /timestamptz '2026-09-27 00:00:00-03'/);
});

test("first tuition due date is always strictly after enrollment", function () {
  assert.match(
    migration,
    /create or replace function public\.first_tuition_due_date_after/
  );
  assert.match(migration, /current_candidate > target_enrollment_date/);
  assert.match(
    migration,
    /public\.first_tuition_due_date_after\(\s*enrollment_date,\s*target_due_day\s*\)/
  );
  assert.match(
    migration,
    /calculated_due\.due_date > coalesce\(\s*timezone\('America\/Sao_Paulo', p\.enrolled_at\)::date/
  );
});

test("repairs invalid open tuition and preserves a hard database guard", function () {
  assert.match(migration, /with invalid_open_tuition as/);
  assert.match(
    migration,
    /reference_month = date_trunc\('month', invalid\.corrected_due\)::date/
  );
  assert.match(
    migration,
    /create trigger monthly_tuition_reject_pre_enrollment_due/
  );
  assert.match(
    migration,
    /O vencimento da mensalidade deve ser posterior à data de matrícula\./
  );
});

test("recovery baseline preserves the same enrollment billing invariants", function () {
  assert.match(baseline, /add column if not exists is_exempt boolean/);
  assert.match(baseline, /add column if not exists enrolled_at timestamptz/);
  assert.match(
    baseline,
    /create or replace function public\.first_tuition_due_date_after/
  );
  assert.match(
    baseline,
    /create trigger monthly_tuition_reject_pre_enrollment_due/
  );
  assert.match(
    workflow,
    /supabase\/baseline\/130_enforce_tuition_after_enrollment\.sql/
  );
});
