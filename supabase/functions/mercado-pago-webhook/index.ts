import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  getDefaultKey,
  JsonRecord,
  PaymentSyncError,
  synchronizeMercadoPagoPayment,
} from "../_shared/mercado_pago_payment_sync.ts";

const encoder = new TextEncoder();

type RegisteredWebhook = {
  event_id?: string;
  status?: string;
  delivery_count?: number;
  processing_attempts?: number;
  replay_count?: number;
  last_processing_started_at?: string | null;
};

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanIdentifier(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return "";
  }
  return String(value).trim().slice(0, maxLength);
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hexFromBytes(new Uint8Array(digest));
}

async function buildDeduplicationKey(options: {
  providerEventId: string;
  providerPaymentId: string;
  eventType: string;
  action: string;
  eventCreatedAt: string;
  bodyText: string;
}): Promise<string> {
  if (options.providerEventId) {
    return await sha256Hex(`mercado_pago|notification|${options.providerEventId}`);
  }

  const bodyFingerprint = await sha256Hex(options.bodyText);
  return await sha256Hex([
    "mercado_pago",
    "fallback",
    options.providerPaymentId,
    options.eventType,
    options.action,
    options.eventCreatedAt,
    bodyFingerprint,
  ].join("|"));
}

function constantTimeEqual(first: string, second: string): boolean {
  const firstBytes = encoder.encode(first.toLowerCase());
  const secondBytes = encoder.encode(second.toLowerCase());
  if (firstBytes.length !== secondBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < firstBytes.length; index += 1) {
    difference |= firstBytes[index] ^ secondBytes[index];
  }
  return difference === 0;
}

async function validateSignature(
  xSignature: string,
  xRequestId: string,
  dataId: string,
  secret: string,
): Promise<boolean> {
  const signatureParts = xSignature.split(",").map((part) => part.trim());
  const timestamp = signatureParts.find((part) => part.startsWith("ts="))?.slice(3) ?? "";
  const receivedSignatures = signatureParts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestamp || !/^\d+$/.test(timestamp) || !receivedSignatures.length || !secret) return false;

  const normalizedDataId = dataId && /[A-Z]/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = [
    normalizedDataId ? `id:${normalizedDataId};` : "",
    xRequestId ? `request-id:${xRequestId};` : "",
    `ts:${timestamp};`,
  ].join("");

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
  const expectedSignature = hexFromBytes(new Uint8Array(signature));
  return receivedSignatures.some((received) => constantTimeEqual(received, expectedSignature));
}

async function recordOperationalEvent(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventType: "invalid_webhook_signature" | "gateway_failure",
  eventCode: string,
  providerPaymentId: string | null = null,
  details: JsonRecord = {},
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_payment_operational_event", {
    target_event_type: eventType,
    target_event_code: eventCode,
    target_attempt_id: null,
    target_provider_payment_id: providerPaymentId,
    target_details: details,
  });

  if (error) console.error("Unable to record payment operational event", eventType, error.message);
}

async function registerWebhook(
  supabaseAdmin: ReturnType<typeof createClient>,
  options: {
    deduplicationKey: string;
    requestId: string;
    providerEventId: string;
    providerPaymentId: string;
    eventType: string;
    action: string;
    metadata?: JsonRecord;
  },
): Promise<RegisteredWebhook> {
  const { data, error } = await supabaseAdmin.rpc("register_mercado_pago_webhook_event", {
    target_deduplication_key: options.deduplicationKey,
    target_request_id: options.requestId || null,
    target_provider_event_id: options.providerEventId || null,
    target_provider_payment_id: options.providerPaymentId || null,
    target_event_type: options.eventType || null,
    target_action: options.action || null,
    target_metadata: options.metadata ?? {},
  });

  if (error || !isRecord(data) || typeof data.event_id !== "string") {
    throw new Error(error?.message || "Unable to persist webhook event");
  }
  return data as RegisteredWebhook;
}

async function finishWebhook(
  supabaseAdmin: ReturnType<typeof createClient>,
  eventId: string,
  status: "processed" | "ignored" | "failed",
  errorCode: string | null = null,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("finish_mercado_pago_webhook_event", {
    target_event_id: eventId,
    target_status: status,
    target_error: errorCode,
  });
  if (error) throw new Error(error.message);
}

function processingIsFresh(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 120_000;
}

function syncErrorHttpStatus(error: PaymentSyncError): number {
  if (error.code.startsWith("gateway_")) return 502;
  if (["provider_data_mismatch", "attempt_mismatch", "payment_identifier_mismatch"].includes(error.code)) {
    return 422;
  }
  return 500;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
  const webhookSecret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "";

  if (!supabaseUrl || !secretKey || !mercadoPagoAccessToken || !webhookSecret) {
    console.error("Missing environment variables for Mercado Pago webhook");
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const requestUrl = new URL(request.url);
  const rawQueryDataId = requestUrl.searchParams.get("data.id") ?? requestUrl.searchParams.get("data_id") ?? "";
  const queryDataId = cleanIdentifier(rawQueryDataId, 128);
  const xSignature = request.headers.get("x-signature") ?? "";
  const rawRequestId = request.headers.get("x-request-id") ?? "";
  const xRequestId = cleanString(rawRequestId, 160);

  if (!(await validateSignature(xSignature, rawRequestId, rawQueryDataId, webhookSecret))) {
    await recordOperationalEvent(
      supabaseAdmin,
      "invalid_webhook_signature",
      "invalid_signature",
      null,
      { has_request_id: !!xRequestId, has_payment_id: !!queryDataId },
    );
    console.warn("Rejected Mercado Pago webhook with invalid signature", xRequestId || "without-request-id");
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const bodyText = await request.text();
  let payload: JsonRecord;
  try {
    const parsed = JSON.parse(bodyText);
    if (!isRecord(parsed)) throw new Error("Invalid body");
    payload = parsed;
  } catch {
    const deduplicationKey = await sha256Hex(
      [xRequestId, queryDataId, "invalid_json", await sha256Hex(bodyText)].join("|"),
    );
    try {
      const logged = await registerWebhook(supabaseAdmin, {
        deduplicationKey,
        requestId: xRequestId,
        providerEventId: "",
        providerPaymentId: queryDataId,
        eventType: "invalid_json",
        action: "",
        metadata: { source: "mercado_pago_webhook", signature_valid: true },
      });
      await finishWebhook(supabaseAdmin, logged.event_id!, "failed", "invalid_json");
    } catch (error) {
      console.error("Unable to log invalid Mercado Pago JSON", error instanceof Error ? error.message : error);
    }
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const payloadData = isRecord(payload.data) ? payload.data : {};
  const eventType = cleanString(payload.type, 50).toLowerCase();
  const action = cleanString(payload.action, 100).toLowerCase();
  const providerEventId = cleanIdentifier(payload.id, 128);
  const providerPaymentId = queryDataId || cleanIdentifier(payloadData.id, 128);
  const eventCreatedAt = cleanString(payload.date_created, 60);
  const deduplicationKey = await buildDeduplicationKey({
    providerEventId,
    providerPaymentId,
    eventType,
    action,
    eventCreatedAt,
    bodyText,
  });

  let logged: RegisteredWebhook;
  try {
    logged = await registerWebhook(supabaseAdmin, {
      deduplicationKey,
      requestId: xRequestId,
      providerEventId,
      providerPaymentId,
      eventType,
      action,
      metadata: {
        source: "mercado_pago_webhook",
        signature_valid: true,
        event_created_at: eventCreatedAt || null,
      },
    });
  } catch (error) {
    console.error("Unable to persist Mercado Pago webhook", error instanceof Error ? error.message : error);
    return jsonResponse({ error: "Unable to persist webhook event" }, 500);
  }

  const eventId = logged.event_id!;
  if (eventType && eventType !== "payment") {
    await finishWebhook(supabaseAdmin, eventId, "ignored");
    return jsonResponse({ ok: true, ignored: eventType });
  }

  if (!providerPaymentId) {
    await finishWebhook(supabaseAdmin, eventId, "failed", "payment_id_missing");
    return jsonResponse({ error: "Payment ID is missing" }, 400);
  }

  if (logged.status === "processed" || logged.status === "ignored") {
    return jsonResponse({ ok: true, duplicate: true, delivery_count: logged.delivery_count ?? 1 });
  }
  if (logged.status === "processing" && processingIsFresh(logged.last_processing_started_at)) {
    return jsonResponse({ ok: true, duplicate: true, processing: true });
  }

  const { error: beginError } = await supabaseAdmin.rpc("begin_mercado_pago_webhook_processing", {
    target_event_id: eventId,
    target_is_replay: false,
  });
  if (beginError) {
    if (beginError.message.includes("já está em processamento")) {
      return jsonResponse({ ok: true, duplicate: true, processing: true });
    }
    console.error("Unable to begin Mercado Pago webhook processing", eventId, beginError.message);
    return jsonResponse({ error: "Unable to process webhook" }, 500);
  }

  try {
    const result = await synchronizeMercadoPagoPayment({
      supabaseAdmin,
      accessToken: mercadoPagoAccessToken,
      paymentId: providerPaymentId,
    });
    await finishWebhook(supabaseAdmin, eventId, "processed");
    return jsonResponse({ ok: true, status: result.provider_status ?? null });
  } catch (error) {
    const syncError = error instanceof PaymentSyncError
      ? error
      : new PaymentSyncError("unexpected_processing_error", "Falha inesperada ao processar pagamento.");

    try {
      await finishWebhook(supabaseAdmin, eventId, "failed", syncError.code);
    } catch (finishError) {
      console.error("Unable to mark webhook as failed", eventId, finishError instanceof Error ? finishError.message : finishError);
    }

    if (syncError.code.startsWith("gateway_")) {
      await recordOperationalEvent(
        supabaseAdmin,
        "gateway_failure",
        `webhook_${syncError.code}`.slice(0, 160),
        providerPaymentId,
      );
    }

    console.error("Unable to apply Mercado Pago webhook", eventId, syncError.code);
    return jsonResponse({ error: "Unable to process payment" }, syncErrorHttpStatus(syncError));
  }
});
