"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261022020800_ignore_safely_blocked_admin_accounts_in_auth_health.sql"),
  "utf8"
);
const checker = fs.readFileSync(
  path.join(root, "scripts/check_supabase_migration_drift.sh"),
  "utf8"
);
const expectedChecksum = "94d44021c9cd6889336b1226c67e101fb3f83d1e046da20a167e3d9a74116c76";
const expectedAlias = [
  "20261022020800",
  "20261022150943",
  "ignore_safely_blocked_admin_accounts_in_auth_health",
  expectedChecksum
].join("|");

test("administrative health migration alias matches the immutable deployed SQL", () => {
  const digest = crypto.createHash("sha256").update(migration.trim()).digest("hex");
  assert.equal(digest, expectedChecksum);
  assert.equal(checker.split(expectedAlias).length - 1, 1);
  assert.match(checker, /local_identity.*expected_git/);
  assert.match(checker, /remote_identity.*expected_remote/);
  assert.match(checker, /local_identity" == "\$expected_git" && "\$remote_identity" == "\$expected_remote"/);
});

test("the migration keeps administrative account health checks private", () => {
  assert.match(migration, /create or replace function private\.is_expected_blocked_admin_identity/i);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /private\.is_banned_administrative_identity\(u\.id\)/i);
  assert.match(migration, /revoke all on function private\.is_expected_blocked_admin_identity/i);
  assert.match(migration, /grant execute on function private\.is_expected_blocked_admin_identity\(uuid\)[\s\S]*to service_role/i);
  assert.match(migration, /revoke all on function private\.run_auth_account_health_check\(boolean\)/i);
});
