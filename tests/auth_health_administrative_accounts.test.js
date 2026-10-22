const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const migration = readFileSync(
  join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20261022020800_ignore_safely_blocked_admin_accounts_in_auth_health.sql"
  ),
  "utf8"
);

test("only deliberately blocked administrative accounts qualify for the exemption", () => {
  assert.match(migration, /p\.access_mode = 'administrative'/);
  assert.match(
    migration,
    /u\.raw_app_meta_data -> 'administrative_student' = 'true'::jsonb/
  );
  assert.match(migration, /private\.is_banned_administrative_identity\(u\.id\)/);
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
});

test("all three false-positive checks exclude only validated administrative identities", () => {
  const exceptionCheck = "not private.is_expected_blocked_admin_identity(p.id)";
  assert.equal(migration.split(exceptionCheck).length - 1, 3);
  assert.match(
    migration,
    /and u\.confirmed_at is null\\n\s+and not private\.is_expected_blocked_admin_identity\(p\.id\)/
  );
  assert.match(
    migration,
    /and not exists \(select 1 from auth\.identities i where i\.user_id = u\.id\)\\n\s+and not private\.is_expected_blocked_admin_identity\(p\.id\)/
  );
  assert.match(
    migration,
    /and l\.google_user_id is null\\n\s+and not private\.is_expected_blocked_admin_identity\(p\.id\)/
  );
});

test("the upgrade preserves prior account-health checks and fails on schema drift", () => {
  assert.match(migration, /pg_get_functiondef\(/);
  assert.match(migration, /updated_definition := existing_definition/);
  assert.match(migration, /if strpos\(updated_definition, expected_clauses\[index_value\]\) = 0/);
  assert.match(migration, /raise exception 'Auth health monitor predicate % has changed'/);
  assert.match(migration, /execute updated_definition/);
  assert.doesNotMatch(
    migration,
    /\b(?:update|delete from|insert into)\s+(?:auth\.users|public\.profiles)\b/i
  );
});

test("both monitoring functions remain restricted to the service role", () => {
  for (const functionName of [
    "is_expected_blocked_admin_identity",
    "run_auth_account_health_check",
  ]) {
    const escaped = functionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const permissionPattern = new RegExp(
      `revoke all on function private\\.${escaped}\\((?:uuid|boolean)\\)` +
        "[\\s\\S]*?from public, anon, authenticated;" +
        "[\\s\\S]*?grant execute on function private\\." +
        `${escaped}\\((?:uuid|boolean)\\)[\\s\\S]*?to service_role;`,
      "i"
    );
    assert.match(migration, permissionPattern);
  }
});
