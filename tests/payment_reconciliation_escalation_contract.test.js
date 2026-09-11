const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationSource = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260911190219_escalate_repeated_mercado_pago_reconciliation_failures.sql"
  ),
  "utf8"
);

test("reconciliation alert escalation preserves retry and uses a three-failure threshold", () => {
  assert.match(migrationSource, /previous_failure_count/);
  assert.match(migrationSource, /current_failure_count/);
  assert.match(migrationSource, /previous_failure_count, 0\) = 0 then 'warning'/);
  assert.match(migrationSource, /previous_failure_count, 0\) < 3/);
  assert.match(migrationSource, /current_failure_count, 0\) >= 3 then 'critical'/);
  assert.match(migrationSource, /'retry_continues', true/);
});

test("critical reconciliation escalation is deduplicated separately from the first warning", () => {
  assert.match(migrationSource, /'reconciliation_failure:' \|\| new\.id::text/);
  assert.match(migrationSource, /'reconciliation_failure_escalated:' \|\| new\.id::text/);
  assert.match(migrationSource, /'reconciliation_failure',\s*'critical'/s);
  assert.match(migrationSource, /'escalation_threshold', 3/);
});

test("gateway failure capture remains intact after reconciliation escalation hardening", () => {
  assert.match(migrationSource, /provider_http_\(429\|5\[0-9\]\{2\}\)_/);
  assert.match(migrationSource, /provider_http_403_pa_unauthorized_result_from_policies/);
  assert.match(migrationSource, /'gateway_failure'/);
});

test("escalation helper is not exposed to application roles", () => {
  assert.match(
    migrationSource,
    /revoke all on function private\.classify_mercado_pago_reconciliation_failure_alert\(integer, integer\)\s+from public, anon, authenticated, service_role/
  );
});
