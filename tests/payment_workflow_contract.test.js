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
  assert.match(workflow, /tests\/payment_sandbox_convergence_seed\.test\.js/);
  assert.match(workflow, /supabase\/functions\/reconcile-mercado-pago-automated\/\*\*/);
  assert.match(workflow, /supabase\/functions\/notify-payment-alert\/\*\*/);
});

test("scheduled sandbox credential validation fails closed when credentials are absent", () => {
  assert.match(workflow, /github\.event_name == 'schedule' \|\| github\.event_name == 'workflow_dispatch'/);
  assert.match(workflow, /MERCADO_PAGO_TEST_ACCESS_TOKEN: \$\{\{ secrets\.MERCADO_PAGO_TEST_ACCESS_TOKEN \}\}/);
  assert.match(workflow, /MERCADO_PAGO_REQUIRE_TEST_CREDENTIAL: "true"/);
  assert.match(workflow, /Probe Mercado Pago test credential with read-only GET/);
});

test("live sandbox card payments require an explicit manual opt-in and isolated test secrets", () => {
  assert.match(workflow, /run_card_probe:/);
  assert.match(workflow, /github\.event_name == 'workflow_dispatch' && inputs\.run_card_probe == true/);
  assert.match(workflow, /MERCADO_PAGO_TEST_PUBLIC_KEY: \$\{\{ secrets\.MERCADO_PAGO_TEST_PUBLIC_KEY \}\}/);
  assert.match(workflow, /MERCADO_PAGO_TEST_CARD_NUMBER: \$\{\{ secrets\.MERCADO_PAGO_TEST_CARD_NUMBER \}\}/);
  assert.match(workflow, /MERCADO_PAGO_SANDBOX_CARD_PROBE: "true"/);
  assert.match(workflow, /Run isolated Mercado Pago card sandbox scenarios/);
});

test("reconciliation convergence seed is manual, deterministic and sandbox-scoped", () => {
  assert.match(workflow, /run_reconciliation_seed:/);
  assert.match(workflow, /reconciliation_external_reference:/);
  assert.match(
    workflow,
    /github\.event_name == 'workflow_dispatch' && inputs\.run_reconciliation_seed == true/
  );
  assert.match(
    workflow,
    /MERCADO_PAGO_TEST_EXTERNAL_REFERENCE: \$\{\{ inputs\.reconciliation_external_reference \}\}/
  );
  assert.match(workflow, /scripts\/mercado_pago_sandbox_seed\.js/);
  assert.match(workflow, /Seed one approved payment for reconciliation convergence/);
});
