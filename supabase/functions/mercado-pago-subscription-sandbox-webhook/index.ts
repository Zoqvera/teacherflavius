import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  getDefaultKey,
  JsonRecord,
} from "../_shared/mercado_pago_payment_sync.ts";

const encoder = new TextEncoder();
const PREAPPROVAL_ENDPOINT = "https://api.mercadopago.com/preapproval";
const AUTHORIZED_PAYMENT_ENDPOINT = "https://api.mercadopago.com/authorized_payments";
const PAYMENT_ENDPOINT = "https://api.mercadopago.com/v1/payments";
const EVENT_TABLE = "mercado_pago_subscription_sandbox_events";
const REFERENCE_PREFIX = "sandbox-subscription-";
const REQUEST_TIMEOUT_MS = 8_000;
const SUPPORTED_EVENT_TYPES = new Set([
  "subscription_preapproval",
  "subscription_authorized_payment",
]);

type SubscriptionPayload = {
  id?: string | number;
  status?: string;
  external_reference?: string | number;
  live_mode?: boolean;
  auto_recurring?: {
    transaction_amount?: number | string;
    currency_id?: string;
  };
};

type AuthorizedPaymentPayload = {
  id?: string | number;
  preapproval_id?: string;
  external_reference?: string | number;
  transaction_amount?: number | string;
  currency_id?: string;
  status?: string;
  summarized?: string;
  payment?: {
    id?: string | number;
    status?: string;
    status_detail?: string;
  };
};

type PaymentPayload = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number | string;
  external_reference?: string | number;
  live_mode?: boolean;
};

type ExistingEvent = {
  id?: string;
  delivery_count?: number;
};

type Evidence = {
  providerStatus: string | null;
  providerStatusDetail: string | null;
  externalReference: string;
  transactionAmount: number | null;
  currencyId: string | null;
  providerPaymentId: string | null;
  metadata: JsonRecord;
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

function cleanIdentifier(value: unknown, maxLength = 128): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "";
  return String(value).trim().slice(0, maxLength);
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  const parts = xSignature.split(",").map((part) => part.trim());
  const timestamp = parts.find((part) => part.startsWith("ts="))?.slice(3) ?? "";
  const signatures = parts
    .filter((part) => part.startsWith("v1="))
    .map((part) => part.slice(3));

  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || !secret) return false;

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
  const expected = await crypto.subtle.sign("HMAC", key, encoder.encode(manifest));
  const expectedHex = hexFromBytes(new Uint8Array(expected));
  return signatures.some((signature) => constantTimeEqual(signature, expectedHex));
}

async function validateSignatureCandidates(
  xSignature: string,
  xRequestId: string,
  candidates: string[],
  secret: string,
): Promise<boolean> {
  const unique = [...new Set(candidates.map((value) => cleanIdentifier(value)))];
  for (const candidate of unique) {
    if (await validateSignature(xSignature, xRequestId, candidate, secret)) return true;
  }
  return false;
}

async function buildDeduplicationKey(options: {
  providerEventId: string;
  eventType: string;
  resourceId: string;
  requestId: string;
  action: string;
  bodyText: string;
}): Promise<string> {
  if (options.providerEventId) {
    return await sha256Hex(
      `mercado_pago|subscription_sandbox|notification|${options.providerEventId}`,
    );
  }

  const bodyFingerprint = await sha256Hex(options.bodyText);
  return await sha256Hex([
    "mercado_pago",
    "subscription_sandbox",
    options.eventType,
    options.resourceId,
    options.requestId,
    options.action,
    bodyFingerprint,
  ].join("|"));
}

async function fetchProviderJson<T>(accessToken: string, url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "X-scope": "stage",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (_error) {
    throw new Error("sandbox_subscription_gateway_unreachable");
  }

  if (!response.ok) {
    throw new Error(`sandbox_subscription_gateway_http_${response.status}`);
  }

  const payload = await response.json();
  if (!isRecord(payload)) throw new Error("sandbox_subscription_gateway_invalid_payload");
  return payload as T;
}

function validateReference(value: unknown): string {
  const reference = cleanIdentifier(value, 160);
  if (!reference.startsWith(REFERENCE_PREFIX)) {
    throw new Error("sandbox_subscription_reference_rejected");
  }
  return reference;
}

function validateAmount(value: unknown): number {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("sandbox_subscription_amount_invalid");
  }
  return amount;
}

function validateCurrency(value: unknown): string {
  const currency = cleanString(value, 8).toUpperCase();
  if (currency !== "BRL") throw new Error("sandbox_subscription_currency_invalid");
  return currency;
}

async function evidenceFromSubscription(
  accessToken: string,
  resourceId: string,
): Promise<Evidence> {
  const subscription = await fetchProviderJson<SubscriptionPayload>(
    accessToken,
    `${PREAPPROVAL_ENDPOINT}/${encodeURIComponent(resourceId)}`,
  );

  if (cleanIdentifier(subscription.id) !== resourceId) {
    throw new Error("sandbox_subscription_id_mismatch");
  }
  if (subscription.live_mode !== false) {
    throw new Error("sandbox_subscription_live_mode_rejected");
  }

  const externalReference = validateReference(subscription.external_reference);
  const amount = validateAmount(subscription.auto_recurring?.transaction_amount);
  const currency = validateCurrency(subscription.auto_recurring?.currency_id);

  return {
    providerStatus: cleanString(subscription.status, 80) || null,
    providerStatusDetail: null,
    externalReference,
    transactionAmount: amount,
    currencyId: currency,
    providerPaymentId: null,
    metadata: {
      provider_resource: "preapproval",
    },
  };
}

async function evidenceFromAuthorizedPayment(
  accessToken: string,
  resourceId: string,
): Promise<Evidence> {
  const invoice = await fetchProviderJson<AuthorizedPaymentPayload>(
    accessToken,
    `${AUTHORIZED_PAYMENT_ENDPOINT}/${encodeURIComponent(resourceId)}`,
  );
  if (cleanIdentifier(invoice.id) !== resourceId) {
    throw new Error("sandbox_subscription_invoice_id_mismatch");
  }

  const subscriptionId = cleanIdentifier(invoice.preapproval_id);
  if (!subscriptionId) throw new Error("sandbox_subscription_preapproval_id_missing");

  const subscriptionEvidence = await evidenceFromSubscription(accessToken, subscriptionId);
  const invoiceReference = cleanIdentifier(invoice.external_reference, 160);
  if (
    invoiceReference
    && invoiceReference !== subscriptionEvidence.externalReference
  ) {
    throw new Error("sandbox_subscription_invoice_reference_mismatch");
  }

  const amount = validateAmount(invoice.transaction_amount);
  if (amount.toFixed(2) !== Number(subscriptionEvidence.transactionAmount).toFixed(2)) {
    throw new Error("sandbox_subscription_invoice_amount_mismatch");
  }
  const currency = validateCurrency(invoice.currency_id);

  const paymentId = cleanIdentifier(invoice.payment?.id);
  let paymentStatus = cleanString(invoice.payment?.status ?? invoice.summarized ?? invoice.status, 80);
  let statusDetail = cleanString(invoice.payment?.status_detail, 300);
  if (paymentId) {
    const payment = await fetchProviderJson<PaymentPayload>(
      accessToken,
      `${PAYMENT_ENDPOINT}/${encodeURIComponent(paymentId)}`,
    );
    if (cleanIdentifier(payment.id) !== paymentId) {
      throw new Error("sandbox_subscription_payment_id_mismatch");
    }
    if (payment.live_mode !== false) {
      throw new Error("sandbox_subscription_payment_live_mode_rejected");
    }
    if (validateReference(payment.external_reference) !== subscriptionEvidence.externalReference) {
      throw new Error("sandbox_subscription_payment_reference_mismatch");
    }
    if (validateAmount(payment.transaction_amount).toFixed(2) !== amount.toFixed(2)) {
      throw new Error("sandbox_subscription_payment_amount_mismatch");
    }

    paymentStatus = cleanString(payment.status, 80);
    statusDetail = cleanString(payment.status_detail, 300);
  }

  return {
    providerStatus: paymentStatus || cleanString(invoice.status, 80) || null,
    providerStatusDetail: statusDetail || null,
    externalReference: subscriptionEvidence.externalReference,
    transactionAmount: amount,
    currencyId: currency,
    providerPaymentId: paymentId || null,
    metadata: {
      provider_resource: "authorized_payment",
      provider_subscription_id: subscriptionId,
      invoice_status: cleanString(invoice.status, 80) || null,
      summarized: cleanString(invoice.summarized, 80) || null,
    },
  };
}

async function persistEvidence(
  supabaseAdmin: ReturnType<typeof createClient>,
  options: {
    deduplicationKey: string;
    requestId: string;
    providerEventId: string;
    resourceId: string;
    eventType: string;
    action: string;
    evidence: Evidence;
    eventCreatedAt: string;
  },
): Promise<number> {
  const { data: existing, error: lookupError } = await supabaseAdmin
    .from(EVENT_TABLE)
    .select("id, delivery_count")
    .eq("deduplication_key", options.deduplicationKey)
    .maybeSingle();

  if (lookupError) throw new Error("sandbox_subscription_evidence_lookup_failed");

  const now = new Date().toISOString();
  const values = {
    request_id: options.requestId || null,
    provider_event_id: options.providerEventId || null,
    provider_resource_id: options.resourceId,
    event_type: options.eventType,
    action: options.action || null,
    live_mode: false,
    signature_valid: true,
    provider_status: options.evidence.providerStatus,
    provider_status_detail: options.evidence.providerStatusDetail,
    external_reference: options.evidence.externalReference,
    transaction_amount: options.evidence.transactionAmount,
    currency_id: options.evidence.currencyId,
    provider_payment_id: options.evidence.providerPaymentId,
    metadata: {
      source: "mercado_pago_subscription_sandbox_webhook",
      event_created_at: options.eventCreatedAt || null,
      ...options.evidence.metadata,
    },
    last_received_at: now,
    updated_at: now,
  };

  if (existing && isRecord(existing) && typeof existing.id === "string") {
    const current = Number((existing as ExistingEvent).delivery_count);
    const deliveryCount = Number.isInteger(current) && current >= 1 ? current + 1 : 2;

    const { error } = await supabaseAdmin
      .from(EVENT_TABLE)
      .update({ ...values, delivery_count: deliveryCount })
      .eq("id", existing.id);
    if (error) throw new Error("sandbox_subscription_evidence_update_failed");
    return deliveryCount;
  }

  const { error } = await supabaseAdmin.from(EVENT_TABLE).insert({
    deduplication_key: options.deduplicationKey,
    ...values,
  });
  if (error) throw new Error("sandbox_subscription_evidence_insert_failed");
  return 1;
}

function processingStatus(code: string): number {
  if (code.startsWith("sandbox_subscription_gateway_")) return 502;
  if (code.includes("evidence_")) return 500;
  return 422;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = (
    Deno.env.get("MERCADO_PAGO_SUBSCRIPTION_STAGE_ACCESS_TOKEN")
    ?? Deno.env.get("MERCADO_PAGO_SUBSCRIPTION_SANDBOX_ACCESS_TOKEN")
    ?? Deno.env.get("MERCADO_PAGO_TEST_ACCESS_TOKEN")
    ?? ""
  ).trim();
  const webhookSecret = (
    Deno.env.get("MERCADO_PAGO_SUBSCRIPTION_SANDBOX_WEBHOOK_SECRET")
    ?? Deno.env.get("MERCADO_PAGO_TEST_WEBHOOK_SECRET")
    ?? ""
  ).trim();

  if (!supabaseUrl || !secretKey || !accessToken || !webhookSecret) {
    console.error("Missing subscription sandbox webhook configuration");
    return jsonResponse({ error: "Subscription sandbox webhook configuration is incomplete" }, 503);
  }

  const url = new URL(request.url);
  const rawQueryDataId = url.searchParams.get("data.id") ?? url.searchParams.get("data_id") ?? "";
  const queryDataId = cleanIdentifier(rawQueryDataId);
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
  const bodyResourceId = cleanIdentifier(payloadData.id);
  const signatureCandidates = queryDataId ? [queryDataId] : [bodyResourceId, ""];

  if (
    !(await validateSignatureCandidates(
      xSignature,
      rawRequestId,
      signatureCandidates,
      webhookSecret,
    ))
  ) {
    return jsonResponse({ error: "Invalid sandbox webhook signature" }, 401);
  }

  const eventType = cleanString(payload.type, 50).toLowerCase();
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    return jsonResponse({ ok: true, ignored: eventType || "unknown" });
  }
  if (payload.live_mode !== false) {
    return jsonResponse({ error: "Only sandbox subscription events are accepted" }, 422);
  }
  if (queryDataId && bodyResourceId && queryDataId !== bodyResourceId) {
    return jsonResponse({ error: "Webhook resource ID mismatch" }, 422);
  }

  const resourceId = queryDataId || bodyResourceId;
  if (!resourceId) return jsonResponse({ error: "Subscription resource ID is missing" }, 400);

  const providerEventId = cleanIdentifier(payload.id);
  const action = cleanString(payload.action, 100).toLowerCase();
  const deduplicationKey = await buildDeduplicationKey({
    providerEventId,
    eventType,
    resourceId,
    requestId,
    action,
    bodyText,
  });

  let evidence: Evidence;
  try {
    evidence = eventType === "subscription_preapproval"
      ? await evidenceFromSubscription(accessToken, resourceId)
      : await evidenceFromAuthorizedPayment(accessToken, resourceId);
  } catch (error) {
    const code = error instanceof Error ? error.message : "sandbox_subscription_processing_failed";
    console.error("Subscription sandbox webhook validation failed", code);
    return jsonResponse(
      { error: "Unable to validate sandbox subscription resource", code },
      processingStatus(code),
    );
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const deliveryCount = await persistEvidence(supabaseAdmin, {
      deduplicationKey,
      requestId,
      providerEventId,
      resourceId,
      eventType,
      action,
      evidence,
      eventCreatedAt: cleanString(payload.date_created, 60),
    });

    return jsonResponse({
      ok: true,
      sandbox: true,
      event_type: eventType,
      provider_resource_id: resourceId,
      provider_status: evidence.providerStatus,
      provider_payment_id: evidence.providerPaymentId,
      delivery_count: deliveryCount,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "sandbox_subscription_evidence_failed";
    console.error("Unable to persist subscription sandbox evidence", code);
    return jsonResponse({ error: "Unable to persist subscription sandbox evidence", code }, 500);
  }
});
