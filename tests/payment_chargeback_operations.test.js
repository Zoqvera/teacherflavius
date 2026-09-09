const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Chargebacks = require("../payment_chargeback_operations.js");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const persistenceMigration = read("supabase/migrations/20260909220501_add_mercado_pago_chargebacks.sql");
const scheduleMigration = read("supabase/migrations/20260909220952_schedule_mercado_pago_chargeback_reconciliation.sql");
const documentationMigration = read("supabase/migrations/20260909233715_add_chargeback_documentation_workflow.sql");
const webhook = read("supabase/functions/mercado-pago-webhook/index.ts");
const chargebackSync = read("supabase/functions/_shared/mercado_pago_chargeback_sync.ts");
const paymentSync = read("supabase/functions/_shared/mercado_pago_payment_sync.ts");
const reconciler = read("supabase/functions/reconcile-mercado-pago-chargebacks/index.ts");
const listing = read("supabase/functions/list-mercado-pago-chargebacks/index.ts");
const manager = read("supabase/functions/manage-mercado-pago-chargeback-documentation/index.ts");
const notifier = read("supabase/functions/notify-payment-alert/index.ts");

test("normalizes and labels chargeback operational states", () => {
  assert.deepEqual(Chargebacks.statusMeta("open"), { label: "EM CONTESTAÇÃO", tone: "open" });
  assert.deepEqual(Chargebacks.statusMeta("won"), { label: "CONTESTAÇÃO GANHA", tone: "won" });
  assert.deepEqual(Chargebacks.statusMeta("lost"), { label: "CONTESTAÇÃO PERDIDA", tone: "lost" });

  const rows = Chargebacks.normalizeChargebacks([
    {
      case_id: "11111111-1111-4111-8111-111111111111",
      tuition_id: "tuition-1",
      chargeback_id: "12345",
      amount: "99.90",
      operational_status: "open",
      documentation_status: "pending",
      preparation_status: "collecting",
      evidence_total: 2,
      evidence_included: 1
    }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 99.9);
  assert.equal(rows[0].operationalStatus, "open");
  assert.equal(rows[0].preparationStatus, "collecting");
  assert.equal(rows[0].evidenceIncluded, 1);
});

test("renders operational chargeback status and documentation workflow", () => {
  const html = Chargebacks.buildMarkup([
    {
      case_id: "11111111-1111-4111-8111-111111111111",
      tuition_id: "tuition-1",
      chargeback_id: "12345",
      amount: 99.9,
      currency: "BRL",
      reason: "cardholder_dispute",
      operational_status: "open",
      payment_status: "charged_back",
      documentation_status: "pending",
      preparation_status: "ready",
      evidence_total: 2,
      evidence_included: 2
    }
  ]);
  assert.match(html, /Chargebacks do Mercado Pago/);
  assert.match(html, /EM CONTESTAÇÃO/);
  assert.match(html, /PRONTA PARA ENVIO/);
  assert.match(html, /GERENCIAR DOCUMENTAÇÃO/);
  assert.match(html, /cardholder_dispute/);
});

test("locks refund or reversal buttons only while chargeback is open", () => {
  const openButton = {
    dataset: { action: "provider-refund", tuitionId: "tuition-1" },
    textContent: "REEMBOLSAR",
    disabled: false,
    title: ""
  };
  const unrelatedButton = {
    dataset: { action: "reverse", tuitionId: "tuition-2" },
    textContent: "ESTORNAR",
    disabled: false,
    title: ""
  };
  const documentRef = {
    querySelectorAll(selector) {
      if (selector === 'button[data-chargeback-locked="true"]') {
        return [openButton, unrelatedButton].filter((button) => button.dataset.chargebackLocked === "true");
      }
      return [openButton, unrelatedButton];
    }
  };

  const count = Chargebacks.lockOpenChargebackActions(documentRef, [{
    case_id: "11111111-1111-4111-8111-111111111111",
    tuition_id: "tuition-1",
    chargeback_id: "12345",
    operational_status: "open"
  }]);
  assert.equal(count, 1);
  assert.equal(openButton.disabled, true);
  assert.equal(openButton.dataset.action, "chargeback-locked");
  assert.equal(openButton.textContent, "EM CONTESTAÇÃO");
  assert.equal(unrelatedButton.disabled, false);
});

test("database persists chargebacks privately and emits a critical first-seen alert", () => {
  assert.match(persistenceMigration, /create table if not exists public\.payment_chargebacks/);
  assert.match(persistenceMigration, /alter table public\.payment_chargebacks enable row level security/);
  assert.match(persistenceMigration, /revoke all on table public\.payment_chargebacks from public, anon, authenticated/);
  assert.match(persistenceMigration, /chargeback_opened/);
  assert.match(persistenceMigration, /'critical'/);
  assert.match(persistenceMigration, /payment_reinstated/);
  assert.match(persistenceMigration, /grant execute on function public\.upsert_mercado_pago_chargeback[\s\S]+ to service_role/);
});

test("webhook recognizes chargeback topic and binds case id to payment id", () => {
  assert.match(webhook, /CHARGEBACK_EVENT_TYPE = "topic_chargebacks_wh"/);
  assert.match(webhook, /payloadData\.payment_id/);
  assert.match(webhook, /synchronizeMercadoPagoChargeback/);
  assert.match(webhook, /sourceWebhookEventId: eventId/);
  assert.match(webhook, /validateSignature/);
});

test("chargeback sync re-queries provider with caller id and payment source of truth", () => {
  assert.match(chargebackSync, /\/v1\/chargebacks\/\$\{encodeURIComponent\(chargebackId\)\}/);
  assert.match(chargebackSync, /"X-Caller-Id": sellerId/);
  assert.match(chargebackSync, /\/users\/me/);
  assert.match(chargebackSync, /synchronizeMercadoPagoPayment/);
  assert.match(chargebackSync, /upsert_mercado_pago_chargeback/);
  assert.match(paymentSync, /mark_mercado_pago_payment_reinstated/);
});

test("open chargebacks have signed periodic reconciliation", () => {
  assert.match(reconciler, /RECONCILIATION_INTERVAL_MS = 6 \* 60 \* 60 \* 1000/);
  assert.match(reconciler, /BATCH_LIMIT = 20/);
  assert.match(reconciler, /validate_mercado_pago_reconciliation_signature/);
  assert.match(reconciler, /\.eq\("operational_status", "open"\)/);
  assert.match(scheduleMigration, /mercado-pago-chargeback-reconciliation/);
  assert.match(scheduleMigration, /'17,47 \* \* \* \*'/);
  assert.match(scheduleMigration, /dispatch_mercado_pago_chargeback_reconciliation/);
});

test("administrative listing and documentation commands are MFA protected", () => {
  assert.match(listing, /is_teacher_admin_mfa/);
  assert.match(listing, /list_mercado_pago_chargeback_documentation_cases/);
  assert.match(listing, /case_id: row\.chargeback_id/);
  assert.doesNotMatch(listing, /provider_payment_id: row\.provider_payment_id/);
  assert.match(manager, /is_teacher_admin_mfa/);
  assert.match(manager, /DOCUMENTAÇÃO ENVIADA/);
  assert.match(documentationMigration, /revoke all on function public\.list_mercado_pago_chargeback_documentation_cases\(date\) from public, anon, authenticated/);
  assert.match(documentationMigration, /grant execute on function public\.mark_mercado_pago_chargeback_documentation_submitted\(uuid,uuid\) to service_role/);
});

test("chargeback alerts cover opening and documentation deadlines", () => {
  assert.match(notifier, /chargeback_opened: "Alerta crítico: nova contestação no Mercado Pago"/);
  assert.match(notifier, /chargeback_documentation_deadline: "Alerta: prazo de documentação de contestação"/);
  assert.match(notifier, /Horas restantes/);
  assert.match(documentationMigration, /interval '72 hours'/);
  assert.match(documentationMigration, /interval '24 hours'/);
});
