const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase/migrations/20261002183500_normalize_historical_tuition_after_enrollment.sql"
  ),
  "utf8"
);

test("historical correction is limited to enrollment dates backed by notifications", function () {
  assert.match(migration, /public\.enrollment_email_notifications/);
  assert.match(migration, /abs\([\s\S]*p\.created_at/);
  assert.match(migration, /mt\.payment_date is not null/);
});

test("historical correction writes an audit event before changing due dates", function () {
  assert.match(migration, /insert into public\.monthly_tuition_events/);
  assert.match(migration, /due_date_corrected_after_enrollment/);
  assert.match(migration, /'old_due_date'/);
  assert.match(migration, /'new_due_date'/);
});

test("Rodolfo uses the completed historical enrollment record", function () {
  assert.match(migration, /d6374ecd-db53-42e1-b909-83f46d4fc7d0/);
  assert.match(migration, /2026-04-30 11:18:00-03/);
});

test("migration fails if a confirmed invalid due date remains", function () {
  assert.match(
    migration,
    /Ainda existem vencimentos anteriores à matrícula com data de matrícula confirmada/
  );
  assert.match(migration, /Ainda existem cobranças abertas anteriores à matrícula/);
});

test("recovery baseline allows the dedicated due-date correction audit action", function () {
  const baseline = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "supabase/baseline/135_allow_tuition_due_date_correction_audit.sql"
    ),
    "utf8"
  );
  const workflow = fs.readFileSync(
    path.join(__dirname, "..", ".github/workflows/validate-supabase-baseline.yml"),
    "utf8"
  );
  assert.match(baseline, /due_date_corrected_after_enrollment/);
  assert.match(
    workflow,
    /supabase\/baseline\/135_allow_tuition_due_date_correction_audit\.sql/
  );
});
