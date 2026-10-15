import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  ResendWebhookError,
  verifyResendWebhook,
} from "../_shared/resend_delivery_core.mjs";

const MAX_WEBHOOK_BYTES = 16 * 1024;

function secretKey(): string {
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (encoded) {
    try {
      const defaultKey = (JSON.parse(encoded) as { default?: unknown }).default;
      if (typeof defaultKey === "string" && defaultKey) return defaultKey;
    } catch {
      // The legacy service-role secret is supported during migration.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function reply(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function readBoundedBody(request: Request): Promise<string> {
  const reader = request.body?.getReader();
  if (!reader) throw new ResendWebhookError();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new ResendWebhookError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return reply(405, { error: "Method not allowed" });
  }

  // Default OFF: deploying code must never activate external intake by itself.
  if (Deno.env.get("RESEND_DELIVERY_TRACKING_ENABLED") !== "true") {
    return reply(503, { error: "Resend delivery tracking is not enabled" });
  }

  const signingSecret = Deno.env.get("RESEND_WEBHOOK_SIGNING_SECRET") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const adminKey = secretKey();
  if (!signingSecret || !supabaseUrl || !adminKey) {
    return reply(503, { error: "Webhook configuration unavailable" });
  }

  let event;
  try {
    const rawBody = await readBoundedBody(request);
    event = await verifyResendWebhook(rawBody, request.headers, signingSecret);
  } catch {
    // Never log raw bodies, headers, signatures or recipient information.
    return reply(401, { error: "Invalid webhook signature or payload" });
  }

  if (event.ignored) return reply(200, { ok: true, ignored: true });

  const admin = createClient(supabaseUrl, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("record_resend_delivery_event", {
    p_provider_event_id: event.eventId,
    p_provider_email_id: event.emailId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
  });

  if (error) {
    console.error("Resend delivery webhook", "persistence_failed");
    // Retry on transient database errors; never falsely acknowledge ingestion.
    return reply(503, { error: "Event persistence unavailable" });
  }

  return reply(200, { ok: true, duplicate: data === false });
});
