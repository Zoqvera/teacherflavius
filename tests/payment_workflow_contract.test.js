const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const workflow = fs.readFileSync(
  path.join(__dirname, "..", ".github", "workflows", "payment-contracts.yml"),
  "utf8"
);

test("payment workflow keeps deterministic contracts on pull requests", () => {
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /Validate payment contracts/);
  assert.match(workflow, /tests\/payment_gateway_contract\.test\.js/);
  assert.match(workflow, /tests\/payment_reconciliation_monitor_contract\.test\.js/);
  assert.match(workflow, /tests\/payment_sandbox_probe\.test\.js/);
  assert.match(workflow, /supabase\/functions\/reconcile-mercado-pago-automated\/\*\*/);
  assert.match(workflow, /supabase\/functions\/notify-payment-alert\/\*\*/);
});

test("sandbox job is restricted to scheduled or explicit executions", () => {
  assert.match(workflow, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /MERCADO_PAGO_TEST_ACCESS_TOKEN: \$\{\{ secrets\.MERCADO_PAGO_TEST_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /node scripts\/mercado_pago_sandbox_probe\.js/);
});
