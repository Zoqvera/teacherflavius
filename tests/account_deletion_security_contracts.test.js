const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migrationPath = path.join(
  root,
  "supabase",
  "migrations",
  "20260912163107_require_mfa_inside_account_deletion_internals.sql"
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("destructive account deletion internals require administrative MFA", function () {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /close_student_account_for_privacy/);
  assert.match(sql, /complete_account_deletion_request__mfa_inner/);
  assert.equal(
    (sql.match(/is_teacher_admin_mfa\(\)/g) || []).length >= 2,
    true
  );
});

test("destructive account deletion internals stay unavailable to browser roles", function () {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(
    sql,
    /revoke all on function public\.close_student_account_for_privacy\(uuid\) from public, anon, authenticated;/i
  );
  assert.match(
    sql,
    /revoke all on function public\.complete_account_deletion_request__mfa_inner\(uuid, text\) from public, anon, authenticated;/i
  );
});

test("student account deletion remains a request workflow rather than immediate client deletion", function () {
  const source = read("privacy_requests.js");

  assert.match(source, /rpc\("request_account_deletion"\)/);
  assert.match(source, /O pedido não apaga tudo imediatamente/);
  assert.doesNotMatch(source, /auth\.admin\.deleteUser/);
  assert.doesNotMatch(source, /deleteUser\(/);
});

test("student can only cancel the active account deletion request through the scoped RPC", function () {
  const source = read("privacy_requests.js");

  assert.match(source, /activeDeletionRequest\.status !== "open"/);
  assert.match(source, /rpc\("cancel_my_account_deletion_request"/);
});
