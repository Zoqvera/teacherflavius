"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHmac } = require("node:crypto");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const handlerPromise = import(pathToFileURL(path.join(
  root, "supabase/functions/_shared/resend_delivery_handler.mjs",
)).href);
const NOW = Date.parse("2026-10-16T18:00:00.000Z");
const keyBytes = Buffer.from("isolated-webhook-secret-not-production-2026", "utf8");
const SIGNING_SECRET = "whsec_" + keyBytes.toString("base64");
const EMAIL_ID = "d1a2b3c4-0000-4000-8000-112233445566";

function signedPayload({
  eventId = "msg_mock_00000001",
  type = "email.delivered",
  signedAt = NOW,
} = {}) {
  const raw = JSON.stringify({
    type,
    created_at: new Date(NOW - 1000).toISOString(),
    data: {
      email_id: EMAIL_ID,
      to: ["not-a-real-student@example.invalid"],
      subject: "Sensitive test subject",
    },
  });
  const timestamp = String(Math.floor(signedAt / 1000));
  const signature = createHmac("sha256", keyBytes)
    .update([eventId, timestamp, raw].join("."))
    .digest("base64");
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

function request(payload, overrides = {}) {
  return new Request("http://fixture.invalid/functions/v1/resend-delivery-webhook", {
    method: "POST",
    headers: overrides.headers || payload.headers,
    body: overrides.body === undefined ? payload.raw : overrides.body,
  });
}

async function fixture({ enabled = true, secret = SIGNING_SECRET, databaseFailure = false } = {}) {
  const { createResendDeliveryHandler } = await handlerPromise;
  const seen = new Map();
  const calls = [];
  const errors = [];
  let clientCreated = 0;
  const handle = createResendDeliveryHandler({
    readConfiguration: () => ({
      enabled,
      signingSecret: secret,
      supabaseUrl: "http://isolated-supabase.invalid",
      adminKey: "mock-service-role-not-production",
    }),
    createAdminClient: (url, key) => {
      assert.equal(url, "http://isolated-supabase.invalid");
      assert.equal(key, "mock-service-role-not-production");
      clientCreated += 1;
      return {
        rpc: async (name, params) => {
          calls.push({ name, params });
          if (databaseFailure === "exception") {
            throw new Error("Simulated database timeout");
          }
          if (databaseFailure) {
            return { data: null, error: { message: "Mock failure" } };
          }
          const existing = seen.get(params.p_provider_event_id);
          if (existing) {
            assert.deepEqual(existing, params);
            return { data: false, error: null };
          }
          seen.set(params.p_provider_event_id, params);
          return { data: true, error: null };
        },
      };
    },
    logError: (message) => errors.push(message),
    now: () => NOW,
  });
  return { handle, calls, errors, seen, clientCreated: () => clientCreated };
}

test("signed delivery reaches the production handler and persists minimum metadata", async () => {
  const system = await fixture();
  const response = await system.handle(request(signedPayload()));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, duplicate: false });
  assert.deepEqual(system.calls, [{
    name: "record_resend_delivery_event",
    params: {
      p_provider_event_id: "msg_mock_00000001",
      p_provider_email_id: EMAIL_ID,
      p_event_type: "email.delivered",
      p_occurred_at: new Date(NOW - 1000).toISOString(),
    },
  }]);
  assert.doesNotMatch(JSON.stringify(system.calls), /Sensitive|not-a-real-student/);
});

test("duplicate signed event is acknowledged and stored exactly once", async () => {
  const system = await fixture();
  const payload = signedPayload({ type: "email.bounced" });
  const first = await system.handle(request(payload));
  const second = await system.handle(request(payload));
  assert.deepEqual(await first.json(), { ok: true, duplicate: false });
  assert.deepEqual(await second.json(), { ok: true, duplicate: true });
  assert.equal(system.seen.size, 1);
});

test("tampering, expired timestamps, and missing signature never create an admin client", async () => {
  const system = await fixture();
  const valid = signedPayload();
  const forged = await system.handle(request(valid, {
    body: valid.raw.replace("email.delivered", "email.bounced"),
  }));
  const stale = await system.handle(request(signedPayload({
    eventId: "msg_mock_stale_001", signedAt: NOW - 301000,
  })));
  const missing = await system.handle(request(valid, {
    headers: { "content-type": "application/json" },
  }));
  for (const response of [forged, stale, missing]) {
    assert.equal(response.status, 401);
  }
  assert.equal(system.clientCreated(), 0);
});

test("disabled intake, wrong method, and unrelated signed events remain safe", async () => {
  const off = await fixture({ enabled: false });
  assert.equal((await off.handle(request(signedPayload()))).status, 503);
  assert.equal(off.clientCreated(), 0);
  const system = await fixture();
  assert.equal((await system.handle(new Request("http://fixture.invalid", {
    method: "GET",
  }))).status, 405);
  const unsupported = await system.handle(request(signedPayload({
    type: "contact.created", eventId: "msg_mock_other_001",
  })));
  assert.deepEqual(await unsupported.json(), { ok: true, ignored: true });
  assert.equal(system.clientCreated(), 0);
});

test("oversized body and invalid UTF-8 cannot reach persistence", async () => {
  const system = await fixture();
  const valid = signedPayload();
  const badUtf8 = await system.handle(request(valid, {
    body: new Uint8Array([255, 254, 253]),
  }));
  const large = await system.handle(request(valid, {
    body: valid.raw + " ".repeat(20000),
  }));
  assert.equal(badUtf8.status, 401);
  assert.equal(large.status, 401);
  assert.equal(system.clientCreated(), 0);
});

test("persistence error and exception return retryable 503 without logging PII", async () => {
  for (const databaseFailure of [true, "exception"]) {
    const system = await fixture({ databaseFailure });
    assert.equal((await system.handle(request(signedPayload()))).status, 503);
    assert.equal(system.calls.length, 1);
    assert.deepEqual(system.errors, ["resend_delivery_event_persistence_unavailable"]);
    assert.doesNotMatch(JSON.stringify(system.errors), /Sensitive|not-a-real-student/);
  }
});

test("all seven delivery events are signed and routed independently", async () => {
  const system = await fixture();
  const kinds = [
    "email.sent", "email.delivery_delayed", "email.delivered",
    "email.failed", "email.bounced", "email.complained", "email.suppressed",
  ];
  for (const [index, type] of kinds.entries()) {
    const response = await system.handle(request(signedPayload({
      type, eventId: "msg_mock_variant_" + String(index).padStart(4, "0"),
    })));
    assert.equal(response.status, 200);
  }
  assert.deepEqual(system.calls.map(c => c.params.p_event_type), kinds);
});
