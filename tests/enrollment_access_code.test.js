const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const onboardingState = read("enrollment_onboarding_state.js");
const migration = read("supabase/migrations/20261001130000_require_enrollment_access_code.sql");
const baseline = read("supabase/baseline/100_require_enrollment_access_code.sql");
const currentMigration = read(
  "supabase/migrations/20261006042754_bind_enrollment_terms_to_access_code.sql"
);
const currentBaseline = read(
  "supabase/baseline/265_bind_enrollment_terms_to_access_code.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("new enrollment fails closed until backend state confirms access authorization", function () {
  assert.match(page, /id="enrollmentAccessForm"/);
  assert.match(page, /id="completeProfileForm" hidden/);
  assert.match(page, /type="password"/);
  assert.match(page, /rpc\("authorize_my_enrollment"/);
  assert.match(page, /EnrollmentOnboardingState/);
  assert.match(onboardingState, /rpc\("get_my_enrollment_onboarding_state"\)/);
  assert.match(page, /if \(!state\.formUnlocked\)/);
});

test("the access-code secret remains server-side in Vault", function () {
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /teacherflavius_enrollment_access_code/);
  assert.doesNotMatch(page, /teacherflavius_enrollment_access_code/);
});

test("server authorization is bound to the authenticated Google account and rate limited", function () {
  assert.match(migration, /requester_id uuid := auth\.uid\(\)/);
  assert.match(migration, /provider_name <> 'google'/);
  assert.match(migration, /failed_attempts/);
  assert.match(migration, /interval '15 minutes'/);
  assert.match(
    migration,
    /revoke all on table private\.student_enrollment_access from public, anon, authenticated/i
  );
});

test("current authorization binds commercial terms to the validated access code", function () {
  for (const sql of [currentMigration, currentBaseline]) {
    assert.match(sql, /teacherflavius_enrollment_access_code/);
    assert.match(sql, /configured_plans := secret_payload::jsonb/);
    assert.match(sql, /selected_plan := configured_plans -> normalized_code/);
    assert.match(sql, /authorized_monthly_fee/);
    assert.match(sql, /authorized_classes_per_month/);
    assert.doesNotMatch(sql, /configured_plans\s*:=\s*'\{/);
    assert.doesNotMatch(sql, /selected_plan\s*:=\s*'\{/);
  }
});

test("direct profile completion cannot bypass current enrollment authorization and terms", function () {
  assert.match(
    currentMigration,
    /from private\.student_enrollment_access access[\s\S]*access\.user_id = new\.id[\s\S]*access\.authorized_at is not null[\s\S]*access\.monthly_fee is not null[\s\S]*access\.classes_per_month is not null/i
  );
  assert.match(
    currentMigration,
    /raise exception 'Valide o código de acesso à matrícula antes de concluir o cadastro\.'/i
  );
});

test("recovery baseline applies both enrollment access overlays", function () {
  assert.match(workflow, /100_require_enrollment_access_code\.sql/);
  assert.match(workflow, /265_bind_enrollment_terms_to_access_code\.sql/);
});
