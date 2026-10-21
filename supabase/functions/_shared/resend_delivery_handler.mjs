import {
  ResendWebhookError,
  verifyResendWebhook,
} from "./resend_delivery_core.mjs";

const MAX_BODY_BYTES = 16 * 1024;

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readRawBodyWithinLimit(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ResendWebhookError();

  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ResendWebhookError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * The same handler runs in production and in isolated HTTP tests.
 * Clients, secrets, and clocks are injected, never stored in module globals.
 * No provider call, email delivery, or database write occurs by importing.
 */
export function createResendDeliveryHandler({
  readConfiguration,
  createAdminClient,
  logError = () => {},
  now = () => Date.now(),
}) {
  return async (request) => {
    if (request.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed" });
    }

    const config = readConfiguration();
    if (!config.enabled) {
      return jsonResponse(503, { error: "Resend tracking is disabled" });
    }
    if (!config.signingSecret || !config.supabaseUrl || !config.adminKey) {
      return jsonResponse(503, { error: "Webhook configuration unavailable" });
    }

    let event;
    try {
      const rawBody = await readRawBodyWithinLimit(request);
      event = await verifyResendWebhook(
        rawBody, request.headers, config.signingSecret, now(),
      );
    } catch {
      // Never log raw requests, signatures, recipients, subjects or content.
      return jsonResponse(401, { error: "Invalid webhook signature or payload" });
    }

    if (event.ignored) {
      return jsonResponse(200, { ok: true, ignored: true });
    }

    try {
      const admin = createAdminClient(config.supabaseUrl, config.adminKey);
      const { data, error } = await admin.rpc("record_resend_delivery_event", {
        p_provider_event_id: event.eventId,
        p_provider_email_id: event.emailId,
        p_event_type: event.eventType,
        p_occurred_at: event.occurredAt,
      });

      if (error || typeof data !== "boolean") {
        throw new Error("Delivery event persistence failed");
      }
      return jsonResponse(200, { ok: true, duplicate: !data });
    } catch {
      logError("resend_delivery_event_persistence_unavailable");
      return jsonResponse(503, { error: "Event persistence unavailable" });
    }
  };
}
