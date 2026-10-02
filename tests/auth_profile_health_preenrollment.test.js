const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    ROOT,
    "supabase/migrations/20261002024000_fix_auth_profile_health_preenrollment.sql"
  ),
  "utf8"
);

test("auth health ignores login-only accounts before enrollment", function () {
  assert.match(migration, /private\.student_enrollment_access access/);
  assert.match(migration, /access\.authorized_at is not null/);
  assert.match(migration, /access\.authorized_at < now\(\) - interval '1 hour'/);
  assert.match(migration, /public\.student_enrollment_invites invite/);
  assert.match(migration, /invite\.status = 'completed'/);
  assert.match(migration, /p\.id is null/);
});

test("auth health migration fails safely if the expected function changes", function () {
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /updated_definition = current_definition/);
  assert.match(migration, /raise exception 'Expected auth-user-without-profile query was not found\.'/);
});
