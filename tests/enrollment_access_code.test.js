const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const migration = read("supabase/migrations/20261001130000_require_enrollment_access_code.sql");
const baseline = read("supabase/baseline/100_require_enrollment_access_code.sql");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("onboarding fails closed until the access code is authorized", function () {
  assert.match(page, /id="enrollmentAccessForm"/);
  assert.match(page, /id="completeProfileForm" hidden/);
  assert.match(page, /type="password"/);
  assert.match(page, /rpc\("authorize_my_enrollment"/);
  assert.match(page, /rpc\("has_my_enrollment_access"/);
});

test("the reusable access code is never committed to public assets or migrations", function () {
  assert.doesNotMatch(page, /93167!/);
  assert.doesNotMatch(migration, /93167!/);
  assert.doesNotMatch(baseline, /93167!/);
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /teacherflavius_enrollment_access_code/);
});

test("server authorization is bound to the authenticated Google account and rate limited", function () {
  assert.match(migration, /requester_id uuid := auth\.uid\(\)/);
  assert.match(migration, /provider_name <> 'google'/);
  assert.match(migration, /failed_attempts/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(migration, /revoke all on table private\.student_enrollment_access from public, anon, authenticated/i);
});

test("direct profile completion cannot bypass enrollment authorization", function () {
  assert.match(
    migration,
    /from private\.student_enrollment_access access[\s\S]*access\.user_id = new\.id[\s\S]*access\.authorized_at is not null/i
  );
  assert.match(
    migration,
    /raise exception 'Valide o código de matrícula antes de concluir o cadastro\.'/i
  );
});

test("recovery baseline applies the enrollment access overlay", function () {
  assert.match(workflow, /100_require_enrollment_access_code\.sql/);
});
