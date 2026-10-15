// Pure functions shared by Edge Functions and Node's isolated test runner.
// Never parse/reformat a webhook body before signature verification.
const DELIVERY_EVENTS = new Set([
  "email.sent",
  "email.delivery_delayed",
  "email.delivered",
  "email.failed",
  "email.bounced",
  "email.complained",
  "email.suppressed",
]);

const EXTERNAL_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;
const SIGNATURE_PATTERN = /^v1,([a-zA-Z0-9+/]+={0,2})$/;
const MAX_BODY_BYTES = 16 * 1024;
const MAX_SIGNATURE_AGE_SECONDS = 300;

export class ResendWebhookError extends Error {
  constructor() {
    super("Invalid Resend webhook");
    this.name = "ResendWebhookError";
  }
}

function decodeBase64(value) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new ResendWebhookError();
  }
}

export async function verifyResendWebhook(rawBody, headers, signingSecret, now = Date.now()) {
  const eventId = headers.get("svix-id") || "";
  const timestamp = headers.get("svix-timestamp") || "";
  const signatures = headers.get("svix-signature") || "";

  if (
    typeof rawBody !== "string" ||
    new TextEncoder().encode(rawBody).length > MAX_BODY_BYTES ||
    !EXTERNAL_ID_PATTERN.test(eventId) ||
    !/^\d{10}$/.test(timestamp) ||
    !signingSecret?.startsWith("whsec_") ||
    signatures.length > 2048
  ) {
    throw new ResendWebhookError();
  }

  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) ||
      Math.abs(now / 1000 - issuedAt) > MAX_SIGNATURE_AGE_SECONDS) {
    throw new ResendWebhookError();
  }

  const keyBytes = decodeBase64(signingSecret.slice(6));
  if (keyBytes.length < 16) throw new ResendWebhookError();

  const key = await crypto.subtle.importKey(
    "raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const signedMessage = new TextEncoder().encode(
    `${eventId}.${timestamp}.${rawBody}`,
  );

  let valid = false;
  for (const candidate of signatures.split(" ")) {
    const match = candidate.match(SIGNATURE_PATTERN);
    if (!match) continue;
    const signature = decodeBase64(match[1]);
    if (signature.length !== 32) continue;
    valid = (await crypto.subtle.verify("HMAC", key, signature, signedMessage)) || valid;
  }
  if (!valid) throw new ResendWebhookError();

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new ResendWebhookError();
  }
  if (!event || typeof event !== "object" || typeof event.type !== "string") {
    throw new ResendWebhookError();
  }

  if (!DELIVERY_EVENTS.has(event.type)) {
    return { ignored: true };
  }

  const emailId = event.data?.email_id;
  const occurredAt = event.created_at;
  const occurredAtMillis = Date.parse(occurredAt);

  if (
    typeof emailId !== "string" ||
    !EXTERNAL_ID_PATTERN.test(emailId) ||
    typeof occurredAt !== "string" ||
    !Number.isFinite(occurredAtMillis) ||
    occurredAtMillis > now + MAX_SIGNATURE_AGE_SECONDS * 1000
  ) {
    throw new ResendWebhookError();
  }

  // Do not return recipient, subject, message body, or provider error details.
  return {
    ignored: false,
    eventId,
    emailId,
    eventType: event.type,
    occurredAt: new Date(occurredAtMillis).toISOString(),
  };
}

export async function recordResendAcceptance(client, response, details) {
  if (!response.ok) return false;

  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return false;
  }

  if (!EXTERNAL_ID_PATTERN.test(payload?.id || "")) return false;

  try {
    const { data, error } = await client.rpc("record_resend_message_acceptance", {
      p_queue_name: details.queueName,
      p_notification_id: details.notificationId,
      p_recipient_role: details.recipientRole,
      p_provider_email_id: payload.id,
    });
    return !error && data === true;
  } catch {
    // The sender marks this as a retryable tracking failure.
    return false;
  }
}
