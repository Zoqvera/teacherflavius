import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type MercadoPagoPayment = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string;
  payment_type_id?: string;
  external_reference?: string;
  live_mode?: boolean;
  date_created?: string;
  date_last_updated?: string;
  date_approved?: string;
};

const encoder = new TextEncoder();
const KNOWN_PAYMENT_STATUSES = new Set([
  "created",
  "pending",
  "approved",
  "authorized",
  "in_process",
  "in_mediation",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
]);

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

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeStatus(value: unknown): string {
  const status = cleanString(value, 40).toLowerCase();
  return KNOWN_PAYMENT_STATUSES.has(status) ? status : "in_process";
}

function normalizePaymentMethod(payment: MercadoPagoPayment): "pix" | "card" {
  return payment.payment_method_id === "pix" || payment.payment_type_id === "bank_transfer"
    ? "pix"
    : "card";
}

function safeDate(value: unknown): string | null {
  const text = cleanString(value, 60);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function hexFromBytes(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
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

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
  const webhookSecret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "";

  if (!supabaseUrl || !secretKey || !mercadoPagoAccessToken || !webhookSecret) {
    console.error("Missing environment variables for Mercado Pago webhook");
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  const requestUrl = new URL(request.url);
  const queryDataId = cleanString(
    requestUrl.searchParams.get("data.id") ?? requestUrl.searchParams.get("data_id"),
    128,
  );
  const xSignature = request.headers.get("x-signature") ?? "";
  const xRequestId = request.headers.get("x-request-id") ?? "";

  if (!(await validateSignature(xSignature, xRequestId, queryDataId, webhookSecret))) {
    console.warn("Rejected Mercado Pago webhook with invalid signature", xRequestId || "without-request-id");
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  let payload: JsonRecord;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) throw new Error("Invalid body");
    payload = parsed;
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const eventType = cleanString(payload.type, 50).toLowerCase();
  if (eventType && eventType !== "payment") {
    return jsonResponse({ ok: true, ignored: eventType });
  }

  const payloadData = isRecord(payload.data) ? payload.data : {};
  const paymentId = queryDataId || cleanString(payloadData.id, 128);
  if (!paymentId) {
    return jsonResponse({ error: "Payment ID is missing" }, 400);
  }

  const mercadoPagoResponse = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `Bearer ${mercadoPagoAccessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!mercadoPagoResponse.ok) {
    console.error("Unable to retrieve Mercado Pago payment", paymentId, mercadoPagoResponse.status);
    return jsonResponse({ error: "Unable to retrieve payment" }, 502);
  }

  const payment = await mercadoPagoResponse.json() as MercadoPagoPayment;
  const returnedPaymentId = payment.id != null ? String(payment.id) : "";
  const attemptId = cleanString(payment.external_reference, 36);
  const amount = Number(payment.transaction_amount);

  if (!returnedPaymentId || returnedPaymentId !== paymentId || !attemptId || !Number.isFinite(amount) || amount <= 0) {
    console.error("Mercado Pago returned inconsistent payment data", paymentId);
    return jsonResponse({ error: "Inconsistent payment data" }, 422);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from("tuition_payment_attempts")
    .select("id, amount, provider_payment_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    console.error("Unable to load local payment attempt", attemptId, attemptError.message);
    return jsonResponse({ error: "Unable to load payment attempt" }, 500);
  }

  if (!attempt || Number(attempt.amount).toFixed(2) !== amount.toFixed(2)) {
    console.error("Payment attempt was not found or amount did not match", attemptId);
    return jsonResponse({ error: "Payment attempt mismatch" }, 422);
  }

  if (attempt.provider_payment_id && attempt.provider_payment_id !== returnedPaymentId) {
    console.error("Payment attempt is linked to another provider payment", attemptId);
    return jsonResponse({ error: "Payment identifier mismatch" }, 422);
  }

  const { error: processError } = await supabaseAdmin.rpc("process_mercado_pago_payment", {
    target_attempt_id: attemptId,
    target_provider_payment_id: returnedPaymentId,
    target_status: normalizeStatus(payment.status),
    target_status_detail: cleanString(payment.status_detail, 300) || null,
    target_amount: amount,
    target_payment_method: normalizePaymentMethod(payment),
    target_live_mode: payment.live_mode === true,
    target_provider_created_at: safeDate(payment.date_created),
    target_provider_updated_at: safeDate(payment.date_last_updated),
    target_approved_at: safeDate(payment.date_approved),
  });

  if (processError) {
    console.error("Unable to apply Mercado Pago webhook", attemptId, processError.message);
    return jsonResponse({ error: "Unable to process payment" }, 500);
  }

  return jsonResponse({ ok: true });
});
