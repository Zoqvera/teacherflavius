const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const page = source("complete-cadastro.html");
const migration = source(
  "supabase/migrations/20261103202822_authorized_invites_do_not_request_manual_code.sql"
);
const baseline = source(
  "supabase/baseline/460_authorized_invites_do_not_request_manual_code.sql"
);

test("invitation authorizes enrollment without manually entering a code", () => {
  assert.doesNotMatch(page, /id="enrollmentAccessCode"|id="enrollmentAccessForm"/);
  assert.match(page, /function readInvitationToken\(\)/);
  assert.match(page, /const token = readInvitationToken\(\)/);
  assert.match(page, /authorize_my_enrollment_link/);
  assert.match(page, /Convite confirmado\. Não é necessário informar código de matrícula/);
  assert.match(page, /if \(readInvitationToken\(\)\) return state/);
});

test("new enrollments retain invite context and never fall back to a manual code", () => {
  assert.match(page, /!state\.formUnlocked && !reservedSeat && !readInvitationToken\(\)/);
  assert.match(page, /window\.location\.replace\(CLASS_SELECTION_PATH\)/);
  assert.match(source("enrollment_invite_client.js"), /get\("convite"\)/);
  assert.match(source("auth_guard_service.js"), /window\.location\.pathname \+ window\.location\.search/);
  assert.match(source("login.html"), /destination\.startsWith\("\/complete-cadastro\/\?"\)/);
});

test("server marks authorized invitations as not requiring a manual code", () => {
  for (const sql of [migration, baseline]) {
    assert.match(
      sql,
      /'requires_access_code', flow_mode = 'new_enrollment' and not access_authorized/
    );
    assert.match(
      sql,
      /flow_mode = 'existing_student_profile_completion'[\s\S]*or \(flow_mode = 'new_enrollment' and access_authorized\)/
    );
    assert.doesNotMatch(sql, /alter table|drop policy|grant execute/i);
  }
  assert.match(
    source(".github/workflows/validate-supabase-baseline.yml"),
    /460_authorized_invites_do_not_request_manual_code\.sql/
  );
});
