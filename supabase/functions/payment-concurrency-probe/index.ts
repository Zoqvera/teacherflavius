import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  getDefaultKey,
  JsonRecord,
  PaymentSyncError,
  synchronizeMercadoPagoPayment,
} from "../_shared/mercado_pago_payment_sync.ts";

const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function hasFreshTimestamp(value: string): boolean {
  if (!/^\d{10,13}$/.test(value)) return false;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return false;
  const timestampMs = value.length <= 10 ? raw * 1000 : raw;
  return Math.abs(Date.now() - timestampMs) <= AUTH_TIMESTAMP_TOLERANCE_MS;
}

function isProviderPaymentId(value: string): boolean {
  return /^[0-9]{1,128}$/.test(value);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
  const reconciliationTimestamp = cleanString(
    request.headers.get("x-reconciliation-timestamp"),
    20,
  );
  const reconciliationSignature = cleanString(
    request.headers.get("x-reconciliation-signature"),
    128,
  ).toLowerCase();

  if (!supabaseUrl || !secretKey || !mercadoPagoAccessToken) {
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  if (
    !hasFreshTimestamp(reconciliationTimestamp)
    || !/^[a-f0-9]{64}$/.test(reconciliationSignature)
  ) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: validSignature, error: signatureError } = await supabaseAdmin.rpc(
    "validate_mercado_pago_reconciliation_signature",
    {
      candidate_timestamp: reconciliationTimestamp,
      candidate_signature: reconciliationSignature,
    },
  );

  if (signatureError) {
    console.error("Unable to validate concurrency probe signature", signatureError.message);
    return jsonResponse({ error: "Unable to validate authorization" }, 500);
  }
  if (validSignature !== true) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : {};
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const paymentId = cleanString(body.payment_id, 128);
  if (!isProviderPaymentId(paymentId)) {
    return jsonResponse({ error: "Invalid provider payment ID" }, 400);
  }

  try {
    const result = await synchronizeMercadoPagoPayment({
      supabaseAdmin,
      accessToken: mercadoPagoAccessToken,
      paymentId,
    });

    return jsonResponse({
      ok: true,
      provider_payment_id: paymentId,
      provider_status: result.provider_status ?? null,
      payment_applied: result.payment_applied === true,
      payment_reversed: result.payment_reversed === true,
      duplicate_payment_detected: result.duplicate_payment_detected === true,
    });
  } catch (error) {
    const syncError = error instanceof PaymentSyncError
      ? error
      : new PaymentSyncError("unexpected_concurrency_probe_error", "Unexpected concurrency probe failure");
    console.error("Mercado Pago concurrency probe failed", syncError.code);
    return jsonResponse(
      { error: "Unable to synchronize payment", code: syncError.code },
      syncError.code.startsWith("gateway_") ? 502 : 422,
    );
  }
});
