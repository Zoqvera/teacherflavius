"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "../supabase/migrations/20261112170247_fix_secret_key_payment_policy_authorization.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");

const serverOnlyFunctions = [
  "get_enrollment_checkout_policy_context(uuid[])",
  "get_enrollment_subscription_policy_context(uuid)",
];

test("payment policies use the effective database role of secret-key calls", () => {
  assert.match(migration, /current_setting\(''role'', true\) is distinct from ''service_role''/);
  assert.match(migration, /pg_catalog\.replace\(function_definition, old_guard, new_guard\)/);
  assert.match(migration, /if updated_functions <> 2 then/);
  assert.match(migration, /raise exception 'Unexpected authorization guard in %'/);
});

test("checkout and subscription policy RPCs remain exclusively server-accessible", () => {
  for (const signature of serverOnlyFunctions) {
    assert.ok(migration.includes(`revoke all on function public.${signature}`));
    assert.ok(migration.includes("from public, anon, authenticated;"));
    assert.ok(migration.includes(`grant execute on function public.${signature} to service_role;`));
  }
});
