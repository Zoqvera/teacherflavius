const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const outboxMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260912182150_add_payment_server_analytics_outbox.sql"),
  "utf8"
);
const preflightMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260912182451_add_payment_analytics_preflight_capture.sql"),
  "utf8"
);
const captureFunction = fs.readFileSync(
  path.join(root, "supabase/functions/capture-payment-analytics-context/index.ts"),
  "utf8"
);
const dispatcherFunction = fs.readFileSync(
  path.join(root, "supabase/functions/dispatch-payment-analytics/index.ts"),
  "utf8"
);
const analyticsPayments = fs.readFileSync(path.join(root, "analytics_payments.js"), "utf8");
const analytics = fs.readFileSync(path.join(root, "analytics.js"), "utf8");
const docs = fs.readFileSync(path.join(root, "docs/payment_server_analytics.md"), "utf8");

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("server payment analytics tables are deny-by-default and service-role only", () => {
  ["payment_analytics_context", "payment_analytics_outbox"].forEach((table) => {
    assert.match(outboxMigration, new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    assert.match(outboxMigration, new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`, "i"));
    assert.match(outboxMigration, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`, "i"));
  });
  assert.match(preflightMigration, /alter table public\.payment_analytics_preflight enable row level security/i);
  assert.match(preflightMigration, /revoke all on table public\.payment_analytics_preflight from public, anon, authenticated/i);
  assert.match(preflightMigration, /grant select, insert, update, delete on table public\.payment_analytics_preflight to service_role/i);
});

test("analytics outbox is deduplicated by event and provider payment", () => {
  assert.match(
    outboxMigration,
    /unique\s*\(event_name, provider_payment_id\)/i
  );
  assert.match(preflightMigration, /on conflict \(event_name, provider_payment_id\) do nothing/i);
  assert.match(outboxMigration, /for update skip locked/i);
  assert.match(outboxMigration, /processing_started_at < now\(\) - interval '10 minutes'/i);
});

test("authoritative settlement drives purchase and provider-confirmed refund events", () => {
  assert.match(preflightMigration, /monthly_tuition_events/i);
  assert.match(preflightMigration, /payment_recorded/);
  assert.match(preflightMigration, /payment_reversed/);
  assert.match(preflightMigration, /coalesce\(payment_event\.details ->> 'source', ''\) <> 'mercado_pago'/i);
  assert.match(preflightMigration, /provider_status', ''\) = 'refunded'/i);
  assert.match(preflightMigration, /backfill_payment_analytics_outbox/i);
});

test("preflight context must match the exact payment identity", () => {
  assert.match(preflightMigration, /idempotency_key = payment_attempt\.idempotency_key/i);
  assert.match(preflightMigration, /tuition_id = payment_attempt\.tuition_id/i);
  assert.match(preflightMigration, /student_id = payment_attempt\.student_id/i);
  assert.match(preflightMigration, /expires_at > now\(\)/i);
});

test("capture endpoint requires explicit consent, JWT identity and tuition ownership", () => {
  assert.match(captureFunction, /body\.analytics_consent !== true/);
  assert.match(captureFunction, /auth\.getUser\(accessToken\)/);
  assert.match(captureFunction, /\.eq\("student_id", user\.id\)/);
  assert.match(captureFunction, /payment_analytics_preflight/);
  assert.match(captureFunction, /backfill_payment_analytics_outbox/);
  assert.doesNotMatch(captureFunction, /MERCADO_PAGO_ACCESS_TOKEN/);
});

test("browser captures context before payment without making analytics financially blocking", () => {
  const captureIndex = analyticsPayments.indexOf("await captureServerAnalyticsContext(payload)");
  const paymentIndex = analyticsPayments.indexOf("await originalInvoke.apply(this, arguments)");
  assert.ok(captureIndex >= 0, "analytics context capture should be present");
  assert.ok(paymentIndex > captureIndex, "analytics context capture should run before payment invocation");
  assert.match(analyticsPayments, /Promise\.race\(\[capturePromise, timeoutPromise\]\)/);
  assert.match(analyticsPayments, /console\.warn\("Não foi possível registrar o contexto analítico do pagamento\."\)/);
  assert.match(analyticsPayments, /if \(completed === true\) trackPurchase\(paidTuitionId\)/);
  assert.match(analytics, /measurementId: MEASUREMENT_ID/);
});

test("dispatcher is fail-closed, HMAC authenticated and uses GA4 Measurement Protocol", () => {
  assert.match(dispatcherFunction, /GA4_API_SECRET/);
  assert.match(dispatcherFunction, /Payment analytics dispatch is not configured/);
  const configCheck = dispatcherFunction.indexOf("Payment analytics dispatch is not configured");
  const claim = dispatcherFunction.indexOf("claim_payment_analytics_outbox");
  assert.ok(configCheck >= 0 && claim > configCheck, "configuration must be checked before claiming outbox rows");
  assert.match(dispatcherFunction, /x-reconciliation-timestamp/);
  assert.match(dispatcherFunction, /x-reconciliation-signature/);
  assert.match(dispatcherFunction, /validate_mercado_pago_reconciliation_signature/);
  assert.match(dispatcherFunction, /https:\/\/www\.google-analytics\.com\/mp\/collect/);
  assert.match(dispatcherFunction, /transaction_id: row\.provider_payment_id/);
  assert.match(dispatcherFunction, /finish_payment_analytics_outbox/);
});

test("stage A intentionally has no analytics dispatch cron and keeps client purchase active", () => {
  const combinedMigrations = outboxMigration + "\n" + preflightMigration;
  assert.doesNotMatch(combinedMigrations, /cron\.schedule/i);
  assert.match(analyticsPayments, /track\("purchase"/);
  assert.match(docs, /Nenhum cron de envio deve ser criado enquanto o segredo não estiver configurado e validado/i);
  assert.match(docs, /Até esses critérios serem satisfeitos, a emissão client-side de `purchase` permanece ativa/i);
});

test("server analytics documentation forbids PII and financial coupling", () => {
  ["nome", "e-mail", "CPF", "número de cartão", "CVV", "Access Token do Mercado Pago"].forEach((term) => {
    assert.match(docs, new RegExp(escapeRegex(term), "i"));
  });
  assert.match(docs, /Analytics não participa da decisão de cobrança ou baixa/i);
  assert.match(docs, /GA4_API_SECRET/);
  assert.match(docs, /G-11V3W5B6TG/);
});
