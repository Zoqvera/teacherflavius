const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase/migrations/20261107171500_fix_financial_gateway_secret_key_compat.sql",
  ),
  "utf8",
);

const serverOnlyFunctions = [
  "get_financial_responsibility_payment_quote_internal",
  "reserve_financial_responsibility_payment",
  "process_financial_responsibility_payment",
];

test("all financial responsibility gateways accept opaque server keys", () => {
  for (const functionName of serverOnlyFunctions) {
    assert.match(migration, new RegExp(`public\\.${functionName}\\(`));
  }

  assert.match(migration, /strpos\(function_definition, role_guard\) > 0/);
  assert.match(migration, /replace\(function_definition, role_guard,/);
  assert.match(migration, /request\.jwt\.claim\.role/);
});

test("financial gateway privileges remain server-only", () => {
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated/,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION %s TO authenticated/);
});
