import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  getDefaultKey,
  JsonRecord,
} from "../_shared/mercado_pago_payment_sync.ts";

const encoder = new TextEncoder();
const PAYMENT_ENDPOINT = "https://api.mercadopago.com/v1/payments";
const SANDBOX_EXTERNAL_REFERENCE_PREFIX = "sandbox-card-";
const SANDBOX_EVENT_TABLE = "mercado_pago_sandbox_webhook_events";
const REQUEST_TIMEOUT_MS = 8_000;

type SandboxPayment = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string;
  external_reference?: string;
  live_mode?: boolean;
};

type ExistingSandboxEvent = {
  id?: string;
  delivery_count?: number;
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
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "";
  return String(value).trim().slice(0, maxLength);
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return hexFromBytes(new Uint8Array(digest));
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

async function validateSignatureCandidates(
  xSignature: string,
  xRequestId: string,
  dataIds: string[],
  secret: string,
): Promise<boolean> {
  const uniqueDataIds = [...new Set(dataIds.map((value) => cleanIdentifier(value, 128)))];
  for (const dataId of uniqueDataIds) {
    if (await validateSignature(xSignature, xRequestId, dataId, secret)) return true;
  }
  return false;
}

async function buildDeduplicationKey(options: {
  providerEventId: string;
  providerPaymentId: string;
  requestId: string;
  action: string;
  bodyText: string;
}): Promise<string> {
  if (options.providerEventId) {
    return await sha256Hex(`mercado_pago|sandbox|notification|${options.providerEventId}`);
  }

  const bodyFingerprint = await sha256Hex(options.bodyText);
  return await sha256Hex([
    "mercado_pago",
    "sandbox",
    options.providerPaymentId,
    options.requestId,
    options.action,
    bodyFingerprint,
  ].join("|"));
}

async function fetchSandboxPayment(accessToken: string, paymentId: string): Promise<SandboxPayment> {
  let response: Response;
  try {
    response = await fetch(`${PAYMENT_ENDPOINT}/${encodeURIComponent(paymentId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (_error) {
    throw new Error("sandbox_gateway_unreachable");
  }

  if (!response.ok) throw new Error(`sandbox_gateway_http_${response.status}`);
  const payload = await response.json();
  if (!isRecord(payload)) throw new Error("sandbox_gateway_invalid_payload");
  return payload as SandboxPayment;
}

function validateSandboxPayment(payment: SandboxPayment, expectedPaymentId: string): void {
  if (String(payment.id ?? "") !== expectedPaymentId) throw new Error("sandbox_payment_id_mismatch");
  if (payment.live_mode !== false) throw new Error("sandbox_live_payment_rejected");

  const externalReference = cleanString(payment.external_reference, 200);
  if (!externalReference.startsWith(SANDBOX_EXTERNAL_REFERENCE_PREFIX)) {
    throw new Error("sandbox_external_reference_rejected");
  }

  const amount = Number(payment.transaction_amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("sandbox_payment_amount_invalid");
}

async function persistEvidence(
  supabaseAdmin: ReturnType<typeof createClient>,
  evidence: {
    deduplicationKey: string;
    requestId: string;
    providerEventId: string;
    providerPaymentId: string;
    action: string;
    payment: SandboxPayment;
    metadata: JsonRecord;
  },
): Promise<number> {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from(SANDBOX_EVENT_TABLE)
    .select("id, delivery_count")
    .eq("deduplication_key", evidence.deduplicationKey)
    .maybeSingle();
  if (lookupError) throw new Error("sandbox_evidence_lookup_failed");

  const commonValues = {
    request_id: evidence.requestId || null,
    provider_event_id: evidence.providerEventId || null,
    provider_payment_id: evidence.providerPaymentId,
    event_type: "payment",
    action: evidence.action || null,
    live_mode: false,
    signature_valid: true,
    provider_status: cleanString(evidence.payment.status, 50) || null,
    provider_status_detail: cleanString(evidence.payment.status_detail, 160) || null,
    external_reference: cleanString(evidence.payment.external_reference, 200) || null,
    transaction_amount: Number(evidence.payment.transaction_amount),
    metadata: evidence.metadata,
    last_received_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (existing && isRecord(existing) && typeof existing.id === "string") {
    const currentCount = Number((existing as ExistingSandboxEvent).delivery_count);
    const deliveryCount = Number.isInteger(currentCount) && currentCount >= 1 ? currentCount + 1 : 2;
    const { error } = await supabaseAdmin
      .from(SANDBOX_EVENT_TABLE)
      .update({ ...commonValues, delivery_count: deliveryCount })
      .eq("id", existing.id);
    if (error) throw new Error("sandbox_evidence_update_failed");
    return deliveryCount;
  }

  const { error } = await supabaseAdmin.from(SANDBOX_EVENT_TABLE).insert({
    deduplication_key: evidence.deduplicationKey,
    ...commonValues,
  });
  if (error) throw new Error("sandbox_evidence_insert_failed");
  return 1;
}

function processingHttpStatus(code: string): number {
  if (code.startsWith("sandbox_gateway_")) return 502;
  if (
    code === "sandbox_evidence_lookup_failed" ||
    code === "sandbox_evidence_update_failed" ||
    code === "sandbox_evidence_insert_failed"
  ) return 500;
  return 422;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = (Deno.env.get("MERCADO_PAGO_TEST_ACCESS_TOKEN") ?? "").trim();
  const webhookSecret = (Deno.env.get("MERCADO_PAGO_TEST_WEBHOOK_SECRET") ?? "").trim();
  if (!supabaseUrl || !secretKey || !accessToken || !webhookSecret) {
    console.error("Missing Mercado Pago sandbox webhook configuration");
    return jsonResponse({ error: "Sandbox webhook configuration is incomplete" }, 503);
  }

  const requestUrl = new URL(request.url);
  const rawQueryDataId = requestUrl.searchParams.get("data.id") ?? requestUrl.searchParams.get("data_id") ?? "";
  const queryDataId = cleanIdentifier(rawQueryDataId, 128);
  const rawRequestId = request.headers.get("x-request-id") ?? "";
  const requestId = cleanString(rawRequestId, 160);
  const xSignature = request.headers.get("x-signature") ?? "";

  const bodyText = await request.text();
  let payload: JsonRecord;
  try {
    const parsed = JSON.parse(bodyText);
    if (!isRecord(parsed)) throw new Error("invalid_body");
    payload = parsed;
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const payloadData = isRecord(payload.data) ? payload.data : {};
  const bodyPaymentId = cleanIdentifier(payloadData.id, 128);
  const signatureDataIdCandidates = queryDataId
    ? [queryDataId]
    : [bodyPaymentId, ""];

  if (!(await validateSignatureCandidates(xSignature, rawRequestId, signatureDataIdCandidates, webhookSecret))) {
    console.warn("Invalid Mercado Pago sandbox webhook signature", {
      has_signature: !!xSignature,
      has_request_id: !!requestId,
      has_query_data_id: !!queryDataId,
      has_body_data_id: !!bodyPaymentId,
    });
    return jsonResponse({ error: "Invalid sandbox webhook signature" }, 401);
  }

  const eventType = cleanString(payload.type, 50).toLowerCase();
  if (eventType !== "payment") return jsonResponse({ ok: true, ignored: eventType || "unknown" });
  if (payload.live_mode !== false) return jsonResponse({ error: "Only sandbox events are accepted" }, 422);

  if (queryDataId && bodyPaymentId && queryDataId !== bodyPaymentId) {
    return jsonResponse({ error: "Webhook payment ID mismatch" }, 422);
  }

  const providerPaymentId = queryDataId || bodyPaymentId;
  if (!providerPaymentId) return jsonResponse({ error: "Payment ID is missing" }, 400);

  const providerEventId = cleanIdentifier(payload.id, 128);
  const action = cleanString(payload.action, 100).toLowerCase();
  const deduplicationKey = await buildDeduplicationKey({
    providerEventId,
    providerPaymentId,
    requestId,
    action,
    bodyText,
  });

  let payment: SandboxPayment;
  try {
    payment = await fetchSandboxPayment(accessToken, providerPaymentId);
    validateSandboxPayment(payment, providerPaymentId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "sandbox_processing_failed";
    console.error("Mercado Pago sandbox webhook validation failed", code);
    return jsonResponse({ error: "Unable to validate sandbox payment", code }, processingHttpStatus(code));
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let deliveryCount: number;
  try {
    deliveryCount = await persistEvidence(supabaseAdmin, {
      deduplicationKey,
      requestId,
      providerEventId,
      providerPaymentId,
      action,
      payment,
      metadata: {
        source: "mercado_pago_sandbox_webhook",
        signature_data_id_source: queryDataId ? "query" : bodyPaymentId ? "body_fallback" : "omitted",
        payment_method_id: cleanString(payment.payment_method_id, 50) || null,
        event_created_at: cleanString(payload.date_created, 60) || null,
      },
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "sandbox_evidence_failed";
    console.error("Unable to persist Mercado Pago sandbox webhook evidence", code);
    return jsonResponse({ error: "Unable to persist sandbox webhook evidence", code }, 500);
  }

  return jsonResponse({
    ok: true,
    sandbox: true,
    provider_payment_id: providerPaymentId,
    provider_status: cleanString(payment.status, 50) || null,
    delivery_count: deliveryCount,
  });
});
