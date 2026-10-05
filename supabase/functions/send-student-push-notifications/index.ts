import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";

type JsonRecord = Record<string, unknown>;

type PushDelivery = {
  delivery_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  notification_title: string;
  notification_body: string;
  target_url: string;
  notification_tag: string;
};

const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const CLAIM_LIMIT = 100;
const CONCURRENCY = 10;

function getDefaultKey(envName: string, legacyName: string): string {
  const raw = Deno.env.get(envName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = parsed?.default;
      if (typeof key === "string" && key) return key;
    } catch (_) {}
  }
  return Deno.env.get(legacyName) ?? "";
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function hasFreshTimestamp(value: string): boolean {
  if (!/^\d{10,13}$/.test(value)) return false;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return false;
  const milliseconds = value.length <= 10 ? raw * 1000 : raw;
  return Math.abs(Date.now() - milliseconds) <= AUTH_TIMESTAMP_TOLERANCE_MS;
}

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getHttpStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = (error as { statusCode?: unknown }).statusCode;
  return typeof candidate === "number" ? candidate : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : "Push delivery failed";
}

async function recordResult(
  supabaseAdmin: ReturnType<typeof createClient>,
  deliveryId: string,
  outcome: "sent" | "failed" | "expired",
  statusCode: number | null,
  errorMessage: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_web_push_delivery_result", {
    target_delivery_id: deliveryId,
    target_outcome: outcome,
    target_status_code: statusCode,
    target_error: errorMessage,
  });

  if (error) {
    console.error("Unable to record Web Push delivery result", deliveryId, error.message);
  }
}

async function sendDelivery(
  supabaseAdmin: ReturnType<typeof createClient>,
  delivery: PushDelivery,
): Promise<"sent" | "failed" | "expired"> {
  const subscription = {
    endpoint: delivery.endpoint,
    keys: {
      p256dh: delivery.p256dh,
      auth: delivery.auth_secret,
    },
  };

  const payload = JSON.stringify({
    title: delivery.notification_title,
    body: delivery.notification_body,
    url: delivery.target_url,
    tag: delivery.notification_tag,
  });

  try {
    await webpush.sendNotification(subscription, payload, {
      TTL: 60 * 60,
      urgency: "high",
    });
    await recordResult(supabaseAdmin, delivery.delivery_id, "sent", null, null);
    return "sent";
  } catch (error) {
    const statusCode = getHttpStatus(error);
    const outcome = statusCode === 404 || statusCode === 410 ? "expired" : "failed";
    await recordResult(
      supabaseAdmin,
      delivery.delivery_id,
      outcome,
      statusCode,
      getErrorMessage(error),
    );
    return outcome;
  }
}

async function processDeliveries(
  supabaseAdmin: ReturnType<typeof createClient>,
  deliveries: PushDelivery[],
): Promise<JsonRecord> {
  const summary = { sent: 0, failed: 0, expired: 0 };

  for (let offset = 0; offset < deliveries.length; offset += CONCURRENCY) {
    const batch = deliveries.slice(offset, offset + CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((delivery) => sendDelivery(supabaseAdmin, delivery)),
    );

    outcomes.forEach((outcome) => {
      summary[outcome] += 1;
    });
  }

  return summary;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const dispatchTimestamp = cleanString(request.headers.get("x-push-timestamp"), 20);
  const dispatchSignature = cleanString(request.headers.get("x-push-signature"), 128).toLowerCase();

  if (!supabaseUrl || !secretKey) {
    console.error("Server environment is incomplete for Web Push delivery");
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  if (!hasFreshTimestamp(dispatchTimestamp) || !/^[a-f0-9]{64}$/.test(dispatchSignature)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: validSignature, error: signatureError } = await supabaseAdmin.rpc(
    "validate_web_push_dispatch_signature",
    {
      candidate_timestamp: dispatchTimestamp,
      candidate_signature: dispatchSignature,
    },
  );

  if (signatureError) {
    console.error("Unable to validate Web Push authorization", signatureError.message);
    return jsonResponse({ error: "Unable to validate authorization" }, 500);
  }
  if (validSignature !== true) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: storedPublicKey, error: publicKeyError } = await supabaseAdmin.rpc(
    "get_web_push_vapid_public_key",
  );
  const { data: storedPrivateKey, error: privateKeyError } = await supabaseAdmin.rpc(
    "get_web_push_vapid_private_key",
  );

  const vapidPublicKey = typeof storedPublicKey === "string" ? storedPublicKey : "";
  const vapidPrivateKey = typeof storedPrivateKey === "string" ? storedPrivateKey : "";

  if (publicKeyError || privateKeyError) {
    console.error("Unable to read Web Push VAPID configuration");
    return jsonResponse({ error: "Push configuration is unavailable" }, 500);
  }

  if (!vapidPublicKey || !vapidPrivateKey) {
    return jsonResponse({ ok: true, claimed: 0, configurationPending: true });
  }

  webpush.setVapidDetails(
    "https://teacherflavius.com",
    vapidPublicKey,
    vapidPrivateKey,
  );

  const { data, error: claimError } = await supabaseAdmin.rpc(
    "claim_due_web_push_notifications",
    { target_limit: CLAIM_LIMIT },
  );

  if (claimError) {
    console.error("Unable to claim Web Push deliveries", claimError.message);
    return jsonResponse({ error: "Unable to load notification deliveries" }, 500);
  }

  const deliveries = (Array.isArray(data) ? data : []) as PushDelivery[];
  const summary = await processDeliveries(supabaseAdmin, deliveries);
  return jsonResponse({ ok: true, claimed: deliveries.length, ...summary });
});
