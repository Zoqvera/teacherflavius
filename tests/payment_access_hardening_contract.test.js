const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260910015722_harden_payment_data_api_surface.sql"),
  "utf8"
);

const FINANCIAL_TABLES = [
  "monthly_tuition",
  "monthly_tuition_events",
  "tuition_payment_attempts",
  "payment_reconciliation_runs",
  "payment_operational_events",
  "payment_alert_notifications",
  "payment_webhook_events",
  "payment_refund_requests",
  "payment_chargebacks",
  "payment_chargeback_documentation_cases",
  "payment_chargeback_documentation_events",
  "payment_chargeback_evidence_items"
];

const SERVER_ONLY_RPCS = [
  "begin_mercado_pago_refund",
  "process_mercado_pago_payment",
  "record_payment_operational_event",
  "register_mercado_pago_webhook_event",
  "list_mercado_pago_refund_candidates",
  "list_mercado_pago_chargebacks",
  "validate_mercado_pago_reconciliation_signature",
  "set_tuition_payment_attempt_updated_at"
];

const PAYMENT_EDGE_FUNCTIONS = [
  "create-mercado-pago-payment/index.ts",
  "mercado-pago-webhook/index.ts",
  "reconcile-mercado-pago-payments/index.ts",
  "reconcile-mercado-pago-automated/index.ts",
  "notify-payment-alert/index.ts",
  "replay-mercado-pago-webhook/index.ts",
  "list-payment-webhooks/index.ts",
  "refund-mercado-pago-payment/index.ts",
  "list-mercado-pago-refund-candidates/index.ts",
  "reconcile-mercado-pago-chargebacks/index.ts",
  "list-mercado-pago-chargebacks/index.ts",
  "manage-mercado-pago-chargeback-documentation/index.ts"
];

test("financial tables deny direct Data API access to client roles", () => {
  FINANCIAL_TABLES.forEach((tableName) => {
    assert.match(
      migration,
      new RegExp(`revoke all privileges on table public\\.${tableName} from anon, authenticated;`)
    );
    assert.match(
      migration,
      new RegExp(`grant select, insert, update, delete on table public\\.${tableName} to service_role;`)
    );
  });
});

test("server-only financial RPCs are explicitly removed from client execution", () => {
  SERVER_ONLY_RPCS.forEach((rpcName) => assert.match(migration, new RegExp(`'${rpcName}'`)));
  assert.match(
    migration,
    /revoke execute on function %s from public, anon, authenticated/
  );
  assert.match(migration, /grant execute on function %s to service_role/);
});

test("payment Edge Functions never read the legacy service-role key directly", () => {
  PAYMENT_EDGE_FUNCTIONS.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, "supabase/functions", relativePath), "utf8");
    assert.doesNotMatch(
      source,
      /Deno\.env\.get\(["']SUPABASE_SERVICE_ROLE_KEY["']\)/,
      `${relativePath} must resolve server credentials through the compatibility key helper`
    );
  });
});

test("core payment functions prefer the new Supabase secret-key bundle", () => {
  [
    "create-mercado-pago-payment/index.ts",
    "mercado-pago-webhook/index.ts",
    "reconcile-mercado-pago-payments/index.ts",
    "reconcile-mercado-pago-automated/index.ts",
    "refund-mercado-pago-payment/index.ts",
    "reconcile-mercado-pago-chargebacks/index.ts"
  ].forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, "supabase/functions", relativePath), "utf8");
    assert.match(source, /SUPABASE_SECRET_KEYS/);
  });
});

test("manual reconciliation requires MFA for broad teacher access", () => {
  const source = fs.readFileSync(
    path.join(root, "supabase/functions/reconcile-mercado-pago-payments/index.ts"),
    "utf8"
  );

  assert.match(source, /getDefaultKey\("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY"\)/);
  assert.match(source, /rpc\("is_teacher_admin_mfa"\)/);
  assert.doesNotMatch(source, /rpc\("is_teacher_admin"\)/);
  assert.match(source, /\.eq\("student_id", user\.id\)/);
});
