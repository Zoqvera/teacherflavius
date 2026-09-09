const test = require("node:test");
const assert = require("node:assert/strict");
const WebhookLog = require("../payment_webhook_log.js");

test("normalizes webhook audit counters", () => {
  const event = WebhookLog.normalizeEvent({
    event_id: "123",
    provider_payment_id: "456",
    event_type: "payment",
    action: "payment.updated",
    status: "failed",
    delivery_count: 3,
    processing_attempts: 2,
    replay_count: 1,
    last_error: "gateway_http_500"
  });

  assert.equal(event.providerPaymentId, "456");
  assert.equal(event.deliveryCount, 3);
  assert.equal(event.processingAttempts, 2);
  assert.equal(event.replayCount, 1);
  assert.equal(event.lastError, "gateway_http_500");
});

test("allows replay only for payment events with a provider payment id", () => {
  assert.equal(WebhookLog.isReplayable(WebhookLog.normalizeEvent({
    event_type: "payment",
    provider_payment_id: "456",
    status: "failed"
  })), true);

  assert.equal(WebhookLog.isReplayable(WebhookLog.normalizeEvent({
    event_type: "merchant_order",
    provider_payment_id: "456",
    status: "ignored"
  })), false);

  assert.equal(WebhookLog.isReplayable(WebhookLog.normalizeEvent({
    event_type: "payment",
    provider_payment_id: "456",
    status: "processing"
  })), false);
});

test("renders audit metadata without raw payload data", () => {
  const markup = WebhookLog.buildMarkup([{
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    provider_payment_id: "123456789",
    event_type: "payment",
    action: "payment.updated",
    status: "processed",
    delivery_count: 2,
    processing_attempts: 1,
    replay_count: 0,
    last_received_at: "2026-09-09T20:00:00Z"
  }]);

  assert.match(markup, /Webhooks do Mercado Pago/);
  assert.match(markup, /123456789/);
  assert.match(markup, /payment\.updated/);
  assert.match(markup, /Entregas/);
  assert.match(markup, /Replays/);
  assert.match(markup, /REPROCESSAR/);
  assert.doesNotMatch(markup, /x-signature/i);
  assert.doesNotMatch(markup, /payload/i);
});

test("renders an empty state when no webhook has been persisted", () => {
  const markup = WebhookLog.buildMarkup([]);
  assert.match(markup, /Nenhum webhook válido registrado ainda/);
});
