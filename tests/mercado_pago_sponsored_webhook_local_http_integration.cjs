"use strict";

// Local Supabase CI only: signed webhook, real TEST-mode provider lookup,
// isolated evidence table, no financial settlement or production credentials.
const assert = require("node:assert/strict");
const { createHmac, randomUUID } = require("node:crypto");

const endpoint = "http://127.0.0.1:54321/functions/v1/mercado-pago-sandbox-webhook";
const paymentId = process.env.MERCADO_PAGO_TEST_PAYMENT_ID || "";
const secret = process.env.MERCADO_PAGO_TEST_WEBHOOK_SECRET || "";

function signPayload(payload, requestId) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const manifest = [
    "id:" + paymentId + ";",
    "request-id:" + requestId + ";",
    "ts:" + timestamp + ";"
  ].join("");

  const signature = createHmac("sha256", secret)
    .update(manifest)
    .digest("hex");

  return {
    raw: JSON.stringify(payload),
    headers: {
      "content-type": "application/json",
      "x-request-id": requestId,
      "x-signature": "ts=" + timestamp + ",v1=" + signature
    }
  };
}

async function deliver(event, override) {
  const query = new URLSearchParams({ "data.id": paymentId, type: "payment" });
  const request = await fetch(endpoint + "?" + query, {
    method: "POST",
    headers: event.headers,
    body: override || event.raw,
    signal: AbortSignal.timeout(14000)
  });
  return { status: request.status, body: await request.json() };
}

async function awaitWebhookReady() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const result = await fetch(endpoint, { signal: AbortSignal.timeout(1200) });
      if (result.status === 405) return;
    } catch {
      // Edge Runtime may be fetching its trusted dependencies locally.
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("Local signed Mercado Pago webhook is unavailable");
}

async function main() {
  assert.match(paymentId, /^\d{8,20}$/, "Sandbox provider payment ID is missing");
  assert.ok(secret.length >= 24, "Local test-only webhook signing key is missing");

  await awaitWebhookReady();

  const event = signPayload({
    id: "ci-financial-responsibility-" + randomUUID(),
    type: "payment",
    action: "payment.updated",
    live_mode: false,
    data: { id: paymentId }
  }, "ci-sponsorship-request-" + randomUUID());

  const first = await deliver(event);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.ok, true);
  assert.equal(first.body.sandbox, true);
  assert.equal(first.body.provider_payment_id, paymentId);
  assert.equal(first.body.provider_status, "approved");
  assert.equal(first.body.delivery_count, 1);

  const replay = await deliver(event);
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.delivery_count, 2);

  // Mercado Pago's HMAC signs the payment ID, request ID and timestamp,
  // not the JSON body. Test an invalid signature, not a changed action.
  const invalidSignature = {
    ...event,
    headers: {
      ...event.headers,
      "x-signature": event.headers["x-signature"].replace(
        /v1=[a-f0-9]{64}/, "v1=" + "0".repeat(64)
      )
    }
  };
  const tampered = await deliver(invalidSignature);
  assert.equal(tampered.status, 401, JSON.stringify(tampered.body));

  const forbiddenLive = signPayload({
    id: "ci-live-mode-rejection-" + randomUUID(),
    type: "payment",
    action: "payment.created",
    live_mode: true,
    data: { id: paymentId }
  }, "ci-invalid-live-" + randomUUID());
  const rejected = await deliver(forbiddenLive);
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));

  console.log("SPONSORSHIP_SANDBOX_SIGNED_HTTP_WEBHOOK_PASSED");
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
