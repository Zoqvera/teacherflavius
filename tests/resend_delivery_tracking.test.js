"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");
const { pathToFileURL } = require("node:url");

const ROOT = path.resolve(__dirname, "..");
const corePath = path.join(ROOT, "supabase/functions/_shared/resend_delivery_core.mjs");
const corePromise = import(pathToFileURL(corePath).href);

const secretBytes = Buffer.from("test-secret-with-32-bytes-minimum-123", "utf8");
const SIGNING_SECRET = `whsec_${secretBytes.toString("base64")}`;
const EMAIL_ID = "a1b2c3d4-0000-4000-8000-aabbccddeeff";
const EVENT_ID = "msg_webhook_01234567";
const NOW = Date.parse("2026-10-15T19:00:00.000Z");

function signedEvent(overrides = {}) {
  const event = {
    type: overrides.type || "email.delivered",
    created_at: overrides.created_at || new Date(NOW - 1000).toISOString(),
    data: { email_id: overrides.email_id || EMAIL_ID,
      to: ["fake-student@example.invalid"], subject: "Sensitive fictitious subject" },
  };
  const rawBody = JSON.stringify(event);
  const id = overrides.id || EVENT_ID;
  const timestamp = String(Math.trunc(
    (overrides.timestamp || NOW) / 1000,
  ));
  const signature = createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return {
    rawBody,
    headers: new Headers({
      "svix-id": id,
      "svix-timestamp": timestamp,
      "svix-signature": `v1,${signature}`,
    }),
  };
}

test("valid signed event retains only necessary metadata", async () => {
  const { verifyResendWebhook } = await corePromise;
  const { rawBody, headers } = signedEvent();
  const result = await verifyResendWebhook(rawBody, headers, SIGNING_SECRET, NOW);
  assert.deepEqual(result, {
    ignored: false,
    eventId: EVENT_ID,
    emailId: EMAIL_ID,
    eventType: "email.delivered",
    occurredAt: new Date(NOW - 1000).toISOString(),
  });
  assert.doesNotMatch(JSON.stringify(result), /fake-student|Sensitive/);
});

test("signatures reject modification, missing headers, invalid secret and stale replay", async () => {
  const { verifyResendWebhook } = await corePromise;
  const { rawBody, headers } = signedEvent();

  await assert.rejects(
    verifyResendWebhook(rawBody.replace("delivered", "bounced"), headers, SIGNING_SECRET, NOW),
  );
  await assert.rejects(
    verifyResendWebhook(rawBody, new Headers(), SIGNING_SECRET, NOW),
  );
  await assert.rejects(
    verifyResendWebhook(rawBody, headers, "whsec_ZmFrZVNlY3JldDEyMzQ1Njc4OTAxMjM0NTY=", NOW),
  );
  await assert.rejects(
    verifyResendWebhook(rawBody, headers, SIGNING_SECRET, NOW + 301000),
  );
});

test("signed unsupported event is ignored without storing the payload", async () => {
  const { verifyResendWebhook } = await corePromise;
  const { rawBody, headers } = signedEvent({ type: "contact.created" });
  assert.deepEqual(
    await verifyResendWebhook(rawBody, headers, SIGNING_SECRET, NOW),
    { ignored: true },
  );
});

test("valid signature with malformed email identity and oversized payload is rejected", async () => {
  const { verifyResendWebhook } = await corePromise;
  const invalid = signedEvent({ email_id: "sensitive-email@example.invalid" });
  await assert.rejects(
    verifyResendWebhook(invalid.rawBody, invalid.headers, SIGNING_SECRET, NOW),
  );
  const valid = signedEvent();
  await assert.rejects(
    verifyResendWebhook(valid.rawBody + " ".repeat(20000),
      valid.headers, SIGNING_SECRET, NOW),
  );
});

test("acceptance correlates one message with the correct role and queue", async () => {
  const { recordResendAcceptance } = await corePromise;
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push({ name, args });
    return { data: true, error: null };
  } };
  const providerResponse = new Response(JSON.stringify({ id: EMAIL_ID }), { status: 200 });
  const recorded = await recordResendAcceptance(client, providerResponse, {
    queueName: "enrollment",
    notificationId: "00000000-0000-4000-8000-000000000001",
    recipientRole: "teacher",
  });
  assert.equal(recorded, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "record_resend_message_acceptance");
  assert.equal(calls[0].args.p_recipient_role, "teacher");
  assert.equal(calls[0].args.p_provider_email_id, EMAIL_ID);
});

test("missing provider ID, provider rejection and database error never count as tracked", async () => {
  const { recordResendAcceptance } = await corePromise;
  const client = { rpc: async () => ({ data: false, error: null }) };
  const details = { queueName: "makeup", notificationId: EMAIL_ID, recipientRole: "student" };
  assert.equal(await recordResendAcceptance(client,
    new Response("{}", { status: 200 }), details), false);
  assert.equal(await recordResendAcceptance(client,
    new Response("rejected", { status: 502 }), details), false);
  assert.equal(await recordResendAcceptance(client,
    new Response(JSON.stringify({ id: EMAIL_ID }), { status: 200 }), details), false);
});

test("config gates webhook and senders; SQL prevents student-side access", () => {
  const config = fs.readFileSync(path.join(ROOT, "supabase/config.toml"), "utf8");
  const webhook = fs.readFileSync(path.join(
    ROOT, "supabase/functions/resend-delivery-webhook/index.ts"), "utf8");
  const sql = fs.readFileSync(path.join(
    ROOT, "supabase/migrations/20261016213000_resend_delivery_tracking_and_retention.sql"), "utf8");
  const senders = [
    "notify-new-enrollment",
    "notify-makeup-booking",
    "notify-regular-lesson-cancellation",
  ];

  assert.match(config, /\[functions\.resend-delivery-webhook\]\s*verify_jwt = false/);
  const handler = fs.readFileSync(path.join(
    ROOT, "supabase/functions/_shared/resend_delivery_handler.mjs"), "utf8");
  assert.match(webhook, /createResendDeliveryHandler/);
  assert.match(handler, /verifyResendWebhook\(\s*rawBody, request\.headers, config\.signingSecret, now\(\)/);
  assert.match(handler, /readRawBodyWithinLimit/);
  assert.match(handler, /record_resend_delivery_event/);
  assert.match(webhook, /RESEND_WEBHOOK_SIGNING_SECRET/);
  assert.match(webhook, /RESEND_DELIVERY_TRACKING_ENABLED/);
  assert.doesNotMatch(webhook, /console\.(error|log)\([^)]*(request|rawBody|event\.data)/);
  for (const sender of senders) {
    const body = fs.readFileSync(path.join(
      ROOT, `supabase/functions/${sender}/index.ts`), "utf8");
    assert.match(body, /RESEND_DELIVERY_TRACKING_ENABLED/);
    assert.match(body, /recordResendAcceptance/);
  }
  assert.match(sql, /on conflict \(provider_event_id\) do nothing/i);
  assert.match(sql, /on conflict \(queue_name, notification_id, recipient_role\) do nothing/i);
  assert.match(sql, /revoke all on function public\.record_resend_delivery_event/i);
  assert.match(sql, /grant execute on function public\.record_resend_delivery_event[\s\S]*to service_role/i);
  assert.match(sql, /interval '90 days'/i);
  assert.match(sql, /interval '180 days'/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /revoke all on function public\.prune_resend_delivery_evidence/i);
  assert.match(sql, /grant delete on private\.resend_delivery_events to service_role/i);
  assert.doesNotMatch(sql, /cron\.schedule\s*\(/i);
  assert.doesNotMatch(sql, /\bemail_address\b|\bsubject\b|\bbody_html\b/i);
});
