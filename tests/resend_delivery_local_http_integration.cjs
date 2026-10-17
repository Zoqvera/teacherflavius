"use strict";
// Disposable Supabase-only HTTP integration, never contact Resend.
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");

const endpoint = "http://127.0.0.1:54321/functions/v1/resend-delivery-webhook";
const signingKey = Buffer.from("resend-test-fixture-secret-32bytes-only", "utf8");
const emailId = "resend-disposable-local-message-01";

function signPayload(type, eventId) {
  const raw = JSON.stringify({
    type,
    created_at: new Date().toISOString(),
    data: {
      email_id: emailId,
      to: ["synthetic-student@example.invalid"],
      subject: "Synthetic event that never emails a person",
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", signingKey)
    .update([eventId, timestamp, raw].join(".")).digest("base64");
  return {
    raw,
    headers: {
      "content-type": "application/json",
      "svix-id": eventId,
      "svix-timestamp": timestamp,
      "svix-signature": "v1," + signature,
    },
  };
}

async function request(event, overrideBody) {
  return fetch(endpoint, {
    method: "POST",
    headers: event.headers,
    body: overrideBody === undefined ? event.raw : overrideBody,
    signal: AbortSignal.timeout(8000),
  });
}

async function waitForLocalEdge() {
  for (let i = 0; i < 35; i += 1) {
    try {
      const check = await fetch(endpoint, {
        method: "GET",
        signal: AbortSignal.timeout(1200),
      });
      if (check.status === 405) return;
    } catch {
      // The local function runtime may still be compiling its imports.
    }
    await new Promise(resolve => setTimeout(resolve, 650));
  }
  throw new Error("Disposable Edge Function did not become ready");
}

async function main() {
  await waitForLocalEdge();

  const delivered = signPayload("email.delivered", "msg_resend_local_01");
  const first = await request(delivered);
  const firstBody = await first.text();
  assert.equal(first.status, 200, firstBody);
  assert.deepEqual(JSON.parse(firstBody), { ok: true, duplicate: false });

  const replay = await request(delivered);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { ok: true, duplicate: true });

  const tampered = await request(delivered, delivered.raw.replace(
    "email.delivered", "email.bounced",
  ));
  assert.equal(tampered.status, 401);

  const bounced = signPayload("email.bounced", "msg_resend_local_02");
  assert.equal((await request(bounced)).status, 200);

  const irrelevant = signPayload("contact.created", "msg_resend_local_03");
  const ignored = await request(irrelevant);
  assert.equal(ignored.status, 200);
  assert.deepEqual(await ignored.json(), { ok: true, ignored: true });

  console.log("Local Resend webhook HTTP signature, persistence and replay: OK");
}

main().catch(error => {
  // Synthetic fixture and test-only failure reason; no real request body.
  console.error(error.message);
  process.exitCode = 1;
});
