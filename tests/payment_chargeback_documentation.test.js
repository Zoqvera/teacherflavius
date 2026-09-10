const test = require("node:test");
const assert = require("node:assert/strict");
const workflow = require("../payment_chargeback_documentation.js");

const NOW = Date.parse("2026-09-09T20:00:00Z");

function sampleCase(overrides) {
  return Object.assign({
    chargebackId: "11111111-1111-4111-8111-111111111111",
    providerChargebackId: "234000062890459000",
    documentationStatus: "pending",
    documentationDeadline: "2026-09-10T20:00:00Z",
    operationalStatus: "open",
    preparationStatus: "ready",
    internalNotes: "",
    submissionMarkedAt: "",
    evidence: [{ id: "e1", category: "service_delivery", label: "Aulas realizadas", notes: "", status: "included" }],
    events: []
  }, overrides || {});
}

test("classifies documentation deadline windows", function () {
  assert.equal(workflow.deadlineState("2026-09-14T20:00:00Z", NOW).tone, "healthy");
  assert.equal(workflow.deadlineState("2026-09-12T00:00:00Z", NOW).tone, "warning");
  assert.equal(workflow.deadlineState("2026-09-10T12:00:00Z", NOW).tone, "critical");
  assert.equal(workflow.deadlineState("2026-09-09T19:00:00Z", NOW).expired, true);
});

test("normalizes provider case, evidence and audit history", function () {
  const result = workflow.normalizeCasePayload({
    case: {
      chargeback_id: "11111111-1111-4111-8111-111111111111",
      provider_chargeback_id: "234000062890459000",
      documentation_status: "pending",
      documentation_deadline: "2026-09-10T20:00:00Z",
      operational_status: "open",
      preparation_status: "collecting",
      internal_notes: "Separar comprovantes"
    },
    evidence: [{ id: "e1", category: "service_delivery", label: "Frequência", status: "verified" }],
    events: [{ action: "evidence_added", created_at: "2026-09-09T19:00:00Z" }]
  });

  assert.equal(result.preparationStatus, "collecting");
  assert.equal(result.evidence[0].status, "verified");
  assert.equal(result.events[0].action, "evidence_added");
  assert.equal(result.events[0].createdAt, "2026-09-09T19:00:00Z");
});

test("preserves camel-case audit timestamps after an in-page refresh", function () {
  const result = workflow.normalizeCasePayload({
    chargebackId: "11111111-1111-4111-8111-111111111111",
    providerChargebackId: "234000062890459000",
    documentationStatus: "pending",
    documentationDeadline: "2026-09-10T20:00:00Z",
    operationalStatus: "open",
    preparationStatus: "ready",
    evidence: [{ id: "e1", category: "service_delivery", label: "Frequência", status: "included", updatedAt: "2026-09-09T19:05:00Z" }],
    events: [{ action: "evidence_updated", createdAt: "2026-09-09T19:06:00Z" }]
  });

  assert.equal(result.evidence[0].updatedAt, "2026-09-09T19:05:00Z");
  assert.equal(result.events[0].createdAt, "2026-09-09T19:06:00Z");
});

test("allows internal submission mark only when every safeguard is satisfied", function () {
  assert.equal(workflow.canMarkSubmitted(sampleCase(), NOW), true);
  assert.equal(workflow.canMarkSubmitted(sampleCase({ documentationStatus: "review_pending" }), NOW), false);
  assert.equal(workflow.canMarkSubmitted(sampleCase({ operationalStatus: "won" }), NOW), false);
  assert.equal(workflow.canMarkSubmitted(sampleCase({ preparationStatus: "collecting" }), NOW), false);
  assert.equal(workflow.canMarkSubmitted(sampleCase({ evidence: [] }), NOW), false);
  assert.equal(workflow.canMarkSubmitted(sampleCase({ documentationDeadline: "2026-09-09T19:00:00Z" }), NOW), false);
});

test("markup states that the portal does not submit files to Mercado Pago", function () {
  const markup = workflow.buildMarkup({
    case: {
      chargeback_id: "11111111-1111-4111-8111-111111111111",
      provider_chargeback_id: "234000062890459000",
      documentation_status: "pending",
      documentation_deadline: "2026-09-10T20:00:00Z",
      operational_status: "open",
      preparation_status: "ready"
    },
    evidence: [{ id: "e1", category: "service_delivery", label: "Registro das aulas", status: "included" }],
    events: []
  });

  assert.match(markup, /não envia arquivos ao Mercado Pago/i);
  assert.match(markup, /MARCAR COMO ENVIADA EXTERNAMENTE/);
  assert.match(markup, /Prova de prestação do serviço/);
});
