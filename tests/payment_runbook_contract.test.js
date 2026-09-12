const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const runbook = read("docs/payment_incident_runbook.md");
const audit = read("docs/payment_operational_audit.md");
const killSwitch = read("docs/payment_kill_switch.md");
const firstCardProtocol = read("docs/payment_first_card_production_validation.md");
const readinessReport = read("docs/payment_operational_readiness_report.md");
const credentialRotation = read("docs/payment_credential_rotation.md");
const firstRefundProtocol = read("docs/payment_first_real_refund_validation.md");
const integrationCleanup = read("docs/payment_integration_cleanup.md");
const providerDecisionGate = read("docs/payment_provider_decision_gate.md");
const productionAvailability = read(".github/workflows/production-availability.yml");

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
  assert.match(audit, /Primeiro cartão real ainda não observado/);
  assert.match(audit, /Janela de requisição em voo no kill switch/);
  assert.match(audit, /Defaults gerenciados pela plataforma/);
  assert.match(audit, /noop-schema-probe/);
  assert.match(audit, /Proteção contra senhas vazadas/);
  assert.doesNotMatch(audit, /Ausência de kill switch financeiro dedicado/);
  assert.doesNotMatch(audit, /Defaults de grants do projeto fora do domínio financeiro/);
});

test("first production card protocol forbids artificial charges and requires authoritative validation", () => {
  assert.match(firstCardProtocol, /Não criar um pagamento real/);
  assert.match(firstCardProtocol, /provider_payment_id/);
  assert.match(firstCardProtocol, /live_mode = true/);
  assert.match(firstCardProtocol, /baixa local ocorreu uma única vez/);
  assert.match(firstCardProtocol, /não repetir a cobrança com uma nova chave de idempotência/);
  assert.match(firstCardProtocol, /health financeiro posterior `healthy`/);
  assert.match(firstCardProtocol, /Não registrar em documentação de repositório/);
});

test("kill switch operations remain documented as recovery-safe", () => {
  assert.match(killSwitch, /manage-payment-creation-control/);
  assert.match(killSwitch, /Webhooks, reconciliação, reembolsos, chargebacks, documentação e alertas continuam operacionais/);
  assert.match(killSwitch, /BLOQUEAR/);
  assert.match(killSwitch, /REATIVAR/);
  assert.match(killSwitch, /requisição que já tenha passado pelo ponto de admissão/i);
});

test("operational readiness report records the verified production snapshot and open gates", () => {
  assert.match(readinessReport, /status = healthy/);
  assert.match(readinessReport, /Tentativas de pagamento \| 16/);
  assert.match(readinessReport, /PIX aprovados \| 10/);
  assert.match(readinessReport, /Cartões aprovados em produção \| 0/);
  assert.match(readinessReport, /Refunds registrados \| 0/);
  assert.match(readinessReport, /Chargebacks registrados \| 0/);
  REQUIRED_CRONS.forEach((name) => assert.match(readinessReport, new RegExp(escapeRegex(name))));
  assert.match(readinessReport, /Primeiro cartão real/);
  assert.match(readinessReport, /Primeiro refund real/);
  assert.match(readinessReport, /Analytics server-side — Fase B/);
  assert.match(readinessReport, /Rotação de credenciais externas/);
});

test("credential rotation runbook never requires sharing secret values", () => {
  [
    "MERCADO_PAGO_ACCESS_TOKEN",
    "MERCADO_PAGO_WEBHOOK_SECRET",
    "MERCADO_PAGO_TEST_ACCESS_TOKEN",
    "MERCADO_PAGO_TEST_WEBHOOK_SECRET",
    "GA4_API_SECRET",
    "mercado_pago_reconciliation_cron_secret"
  ].forEach((name) => assert.match(credentialRotation, new RegExp(escapeRegex(name))));
  assert.match(credentialRotation, /Nunca colocar em chat, issue, PR, commit, log ou screenshot/i);
  assert.match(credentialRotation, /não deve ser rotacionado quando todos os signatários e validadores/i);
  assert.match(credentialRotation, /Nenhuma credencial externa foi rotacionada automaticamente/i);
  assert.match(credentialRotation, /kill switch de \*\*novas cobranças\*\*/i);
});

test("first real refund protocol requires legitimate need, MFA, stable idempotency and convergence", () => {
  assert.match(firstRefundProtocol, /necessidade legítima de devolução/i);
  assert.match(firstRefundProtocol, /Não criar nem reembolsar uma transação real apenas para testar/i);
  assert.match(firstRefundProtocol, /MFA\/AAL2/);
  assert.match(firstRefundProtocol, /REEMBOLSAR/);
  assert.match(firstRefundProtocol, /reutilizar a mesma `idempotency_key`/);
  assert.match(firstRefundProtocol, /reconsultar o Mercado Pago \*\*antes\*\*/i);
  assert.match(firstRefundProtocol, /HTTP 202 não deve ser tratado como falha nem como conclusão final/i);
  assert.match(firstRefundProtocol, /health financeiro posterior `healthy` com `issue_count = 0`/);
});

test("integration cleanup removes obsolete hosting triggers without deleting historical evidence", () => {
  assert.match(integrationCleanup, /GitHub Pages/);
  assert.match(integrationCleanup, /Migrations aplicadas são histórico imutável/);
  assert.match(integrationCleanup, /guard do Security baseline.*deve permanecer/is);
  assert.match(integrationCleanup, /noop-schema-probe/);
  assert.match(integrationCleanup, /HTTP 410/);
  assert.doesNotMatch(productionAvailability, /netlify\.toml/i);
  assert.doesNotMatch(productionAvailability, /netlify\/\*\*/i);
});

test("future provider decision gate defaults to no-go until financial safety is proven", () => {
  assert.match(providerDecisionGate, /Mercado Pago permanece o único provedor financeiro de produção/);
  assert.match(providerDecisionGate, /não autoriza migração, multi-provider ou fallback automático/i);
  assert.match(providerDecisionGate, /Webhooks isolados por segredo\/provedor/i);
  assert.match(providerDecisionGate, /Nunca fazer fallback automático de uma cobrança falhada para outro gateway/i);
  assert.match(providerDecisionGate, /Sem esses itens, a decisão é \*\*NO-GO\*\*/);
  assert.match(providerDecisionGate, /manter Mercado Pago como provedor único/i);
});

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
