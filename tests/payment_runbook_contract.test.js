const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const runbook = fs.readFileSync(path.join(root, "docs/payment_incident_runbook.md"), "utf8");
const audit = fs.readFileSync(path.join(root, "docs/payment_operational_audit.md"), "utf8");
const killSwitch = fs.readFileSync(path.join(root, "docs/payment_kill_switch.md"), "utf8");

const REQUIRED_INCIDENTS = [
  "Pagamento pendente por tempo excessivo",
  "Pagamento aprovado sem baixa",
  "Pagamento duplicado",
  "Webhook ausente, duplicado ou falhado",
  "Assinatura de webhook inválida",
  "Reconciliação automática atrasada ou falhando",
  "Falha do Mercado Pago / indisponibilidade do gateway",
  "Refund",
  "Chargeback",
  "Alertas financeiros não entregues",
  "Health check financeiro `degraded`, `critical` ou `ATRASADO`"
];

const REQUIRED_CRONS = [
  "mercado-pago-reconciliation",
  "mercado-pago-chargeback-reconciliation",
  "payment-alert-health-scan",
  "payment-financial-health-check"
];

const REQUIRED_EDGE_FUNCTIONS = [
  "create-mercado-pago-payment",
  "mercado-pago-webhook",
  "reconcile-mercado-pago-payments",
  "reconcile-mercado-pago-automated",
  "replay-mercado-pago-webhook",
  "list-payment-webhooks",
  "notify-payment-alert",
  "refund-mercado-pago-payment",
  "list-mercado-pago-refund-candidates",
  "reconcile-mercado-pago-chargebacks",
  "list-mercado-pago-chargebacks",
  "manage-mercado-pago-chargeback-documentation",
  "manage-payment-creation-control"
];

test("incident runbook covers every operational payment failure class", () => {
  REQUIRED_INCIDENTS.forEach((incident) => assert.match(runbook, new RegExp(escapeRegex(incident))));
  assert.match(runbook, /P0 — integridade financeira ou segurança/);
  assert.match(runbook, /P1 — indisponibilidade ou perda de convergência/);
  assert.match(runbook, /P2 — caso isolado com operação geral saudável/);
});

test("runbook enforces safe recovery principles", () => {
  assert.match(runbook, /não crie uma nova cobrança enquanto existir uma tentativa ativa/i);
  assert.match(runbook, /replay deve reconsultar o pagamento atual no Mercado Pago/i);
  assert.match(runbook, /não envie uma segunda solicitação de refund/i);
  assert.match(runbook, /Exija uma execução posterior `healthy` com `issue_count = 0`/);
  assert.match(runbook, /Nunca inclua tokens, segredos Supabase, assinatura HMAC, dados completos de cartão ou CPF/i);
});

test("operational audit inventories all financial crons and Edge Functions", () => {
  REQUIRED_CRONS.forEach((name) => assert.match(audit, new RegExp(escapeRegex(name))));
  REQUIRED_EDGE_FUNCTIONS.forEach((name) => assert.match(audit, new RegExp(escapeRegex(name))));
});

test("operational audit records current residual risks instead of obsolete ones", () => {
  assert.match(audit, /Riscos residuais/);
  assert.match(audit, /Janela de requisição em voo no kill switch/);
  assert.match(audit, /Defaults gerenciados pela plataforma/);
  assert.match(audit, /noop-schema-probe/);
  assert.match(audit, /Proteção contra senhas vazadas/);
  assert.doesNotMatch(audit, /Ausência de kill switch financeiro dedicado/);
  assert.doesNotMatch(audit, /Defaults de grants do projeto fora do domínio financeiro/);
});

test("kill switch operations remain documented as recovery-safe", () => {
  assert.match(killSwitch, /manage-payment-creation-control/);
  assert.match(killSwitch, /Webhooks, reconciliação, reembolsos, chargebacks, documentação e alertas continuam operacionais/);
  assert.match(killSwitch, /BLOQUEAR/);
  assert.match(killSwitch, /REATIVAR/);
  assert.match(killSwitch, /requisição que já tenha passado pelo ponto de admissão/i);
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
