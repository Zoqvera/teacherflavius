import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  getDefaultKey,
  JsonRecord,
  PaymentSyncError,
  synchronizeMercadoPagoPayment,
} from "../_shared/mercado_pago_payment_sync.ts";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);
const TERMINAL_REVERSAL_STATUSES = new Set(["refunded", "charged_back", "cancelled"]);
const REFUND_CONFIRMATION = "REEMBOLSAR";
const PROVIDER_TIMEOUT_MS = 10_000;

type RefundStart = {
  request_id: string;
  attempt_id: string;
  provider_payment_id: string;
  idempotency_key: string;
  amount: number | string;
  status: string;
  already_complete?: boolean;
  busy?: boolean;
  skip_provider_call?: boolean;
};

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin) ? origin : "https://teacherflavius.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeAccessToken(value: string | undefined): string {
  let token = (value ?? "").trim();
  if (/^MERCADO_PAGO_ACCESS_TOKEN\s*=/i.test(token)) {
    token = token.replace(/^MERCADO_PAGO_ACCESS_TOKEN\s*=\s*/i, "").trim();
  }
  if (/^Bearer\s+/i.test(token)) token = token.replace(/^Bearer\s+/i, "").trim();
  const quoted = (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"));
  return quoted ? token.slice(1, -1).trim() : token;
}

function parseRefundStart(value: unknown): RefundStart | null {
  if (!isRecord(value)) return null;
  const requestId = cleanString(value.request_id, 36);
  const attemptId = cleanString(value.attempt_id, 36);
  const providerPaymentId = cleanString(value.provider_payment_id, 128);
  const idempotencyKey = cleanString(value.idempotency_key, 36);
  if (!isUuid(requestId) || !isUuid(attemptId) || !providerPaymentId || !isUuid(idempotencyKey)) return null;
  return {
    request_id: requestId,
    attempt_id: attemptId,
    provider_payment_id: providerPaymentId,
    idempotency_key: idempotencyKey,
    amount: Number(value.amount),
    status: cleanString(value.status, 40),
    already_complete: value.already_complete === true,
    busy: value.busy === true,
    skip_provider_call: value.skip_provider_call === true,
  };
}

async function finishRefund(
  supabaseAdmin: ReturnType<typeof createClient>,
  requestId: string,
  status: "provider_accepted" | "synchronized" | "failed",
  providerRefundId: string | null,
  errorCode: string | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("finish_mercado_pago_refund", {
    target_request_id: requestId,
    target_status: status,
    target_provider_refund_id: providerRefundId,
    target_error: errorCode,
  });
  if (error || data !== true) {
    throw new Error(error?.message ?? "Unable to persist refund state");
  }
}

async function recordGatewayFailure(
  supabaseAdmin: ReturnType<typeof createClient>,
  code: string,
  attemptId: string,
  providerPaymentId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_payment_operational_event", {
    target_event_type: "gateway_failure",
    target_event_code: `refund_${code}`.slice(0, 160),
    target_attempt_id: attemptId,
    target_provider_payment_id: providerPaymentId,
    target_details: { source: "admin_refund" },
  });
  if (error) console.error("Unable to record refund gateway failure", error.message);
}

async function recordReconciliationFailure(
  supabaseAdmin: ReturnType<typeof createClient>,
  attemptId: string,
  errorCode: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_mercado_pago_reconciliation_failure", {
    target_attempt_id: attemptId,
    target_error: `refund_${errorCode}`.slice(0, 1000),
  });
  if (error) console.error("Unable to record refund reconciliation failure", error.message);
}

async function synchronizeCurrentState(options: {
  supabaseAdmin: ReturnType<typeof createClient>;
  accessToken: string;
  paymentId: string;
}): Promise<JsonRecord> {
  return await synchronizeMercadoPagoPayment({
    supabaseAdmin: options.supabaseAdmin,
    accessToken: options.accessToken,
    paymentId: options.paymentId,
  });
}

function isReversed(result: JsonRecord): boolean {
  const status = cleanString(result.provider_status, 40);
  return TERMINAL_REVERSAL_STATUSES.has(status) && result.payment_reversed === true;
}

async function createFullRefund(
  accessToken: string,
  paymentId: string,
  idempotencyKey: string,
): Promise<{ ok: boolean; status: number; refundId: string | null }> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
          "X-Idempotency-Key": idempotencyKey,
        },
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      },
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "network_error";
    throw new PaymentSyncError(`gateway_${errorName}`.slice(0, 120), "Mercado Pago indisponível.");
  }

  let payload: JsonRecord = {};
  try {
    const parsed = await response.json();
    if (isRecord(parsed)) payload = parsed;
  } catch (_) {
    // A resposta HTTP é suficiente para decidir o próximo passo.
  }

  const rawRefundId = payload.id;
  const refundId = typeof rawRefundId === "string" || typeof rawRefundId === "number"
    ? String(rawRefundId).slice(0, 128)
    : null;
  return { ok: response.ok, status: response.status, refundId };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = normalizeAccessToken(Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN"));
  const authorization = request.headers.get("authorization") ?? "";

  if (!supabaseUrl || !anonKey || !secretKey || !accessToken || !authorization) {
    return jsonResponse(request, { error: "Server configuration is incomplete" }, 500);
  }

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    body = isRecord(parsed) ? parsed : {};
  } catch (_) {
    return jsonResponse(request, { error: "Invalid JSON body" }, 400);
  }

  const tuitionId = body.tuition_id;
  const reason = cleanString(body.reason, 500);
  const confirmation = cleanString(body.confirmation, 40).toUpperCase();
  if (!isUuid(tuitionId)) return jsonResponse(request, { error: "Invalid tuition ID" }, 400);
  if (confirmation !== REFUND_CONFIRMATION) {
    return jsonResponse(request, { error: "Explicit refund confirmation is required" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: isAdmin, error: adminError }, { data: userData, error: userError }] = await Promise.all([
    userClient.rpc("is_teacher_admin_mfa"),
    userClient.auth.getUser(),
  ]);
  if (adminError || isAdmin !== true || userError || !userData.user?.id) {
    return jsonResponse(request, { error: "Administrative MFA is required" }, 403);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: startData, error: startError } = await supabaseAdmin.rpc("begin_mercado_pago_refund", {
    target_tuition_id: tuitionId,
    target_actor_id: userData.user.id,
    target_reason: reason || null,
  });
  if (startError) {
    const status = startError.code === "22023" ? 422 : (startError.code === "P0002" ? 404 : 500);
    return jsonResponse(request, { error: "Unable to start refund", code: startError.code ?? null }, status);
  }

  const refund = parseRefundStart(startData);
  if (!refund) return jsonResponse(request, { error: "Invalid refund state" }, 500);
  if (refund.already_complete) {
    return jsonResponse(request, { ok: true, already_refunded: true, synchronized: true });
  }
  if (refund.busy) {
    return jsonResponse(request, { error: "Refund is already processing", code: "refund_in_progress" }, 409);
  }

  try {
    const current = await synchronizeCurrentState({
      supabaseAdmin,
      accessToken,
      paymentId: refund.provider_payment_id,
    });
    if (isReversed(current)) {
      await finishRefund(supabaseAdmin, refund.request_id, "synchronized", null, null);
      return jsonResponse(request, {
        ok: true,
        already_refunded: true,
        synchronized: true,
        provider_status: current.provider_status ?? null,
      });
    }
  } catch (error) {
    const syncError = error instanceof PaymentSyncError
      ? error
      : new PaymentSyncError("pre_refund_sync_failed", "Unable to verify current provider state");
    await finishRefund(supabaseAdmin, refund.request_id, "failed", null, syncError.code);
    if (syncError.code.startsWith("gateway_")) {
      await recordGatewayFailure(supabaseAdmin, syncError.code, refund.attempt_id, refund.provider_payment_id);
    }
    return jsonResponse(request, { error: "Unable to verify payment before refund", code: syncError.code }, 502);
  }

  let providerRefundId: string | null = null;
  if (!refund.skip_provider_call) {
    try {
      const providerResult = await createFullRefund(
        accessToken,
        refund.provider_payment_id,
        refund.idempotency_key,
      );
      providerRefundId = providerResult.refundId;

      if (!providerResult.ok) {
        try {
          const afterFailure = await synchronizeCurrentState({
            supabaseAdmin,
            accessToken,
            paymentId: refund.provider_payment_id,
          });
          if (isReversed(afterFailure)) {
            await finishRefund(supabaseAdmin, refund.request_id, "synchronized", providerRefundId, null);
            return jsonResponse(request, {
              ok: true,
              synchronized: true,
              provider_status: afterFailure.provider_status ?? null,
            });
          }
        } catch (_) {
          // A mesma chave idempotente será reutilizada em uma nova tentativa.
        }

        const code = `provider_http_${providerResult.status}`;
        await finishRefund(supabaseAdmin, refund.request_id, "failed", providerRefundId, code);
        if (providerResult.status >= 500 || providerResult.status === 429) {
          await recordGatewayFailure(supabaseAdmin, code, refund.attempt_id, refund.provider_payment_id);
        }
        return jsonResponse(
          request,
          { error: "Mercado Pago rejected the refund", code },
          providerResult.status >= 500 ? 502 : 422,
        );
      }

      await finishRefund(supabaseAdmin, refund.request_id, "provider_accepted", providerRefundId, null);
    } catch (error) {
      const providerError = error instanceof PaymentSyncError
        ? error
        : new PaymentSyncError("gateway_unexpected_error", "Unexpected Mercado Pago refund failure");

      try {
        const afterAmbiguousFailure = await synchronizeCurrentState({
          supabaseAdmin,
          accessToken,
          paymentId: refund.provider_payment_id,
        });
        if (isReversed(afterAmbiguousFailure)) {
          await finishRefund(supabaseAdmin, refund.request_id, "synchronized", providerRefundId, null);
          return jsonResponse(request, {
            ok: true,
            synchronized: true,
            provider_status: afterAmbiguousFailure.provider_status ?? null,
          });
        }
      } catch (_) {
        // O resultado permanece ambíguo; a retentativa reutilizará a mesma chave.
      }

      await finishRefund(supabaseAdmin, refund.request_id, "failed", providerRefundId, providerError.code);
      await recordGatewayFailure(supabaseAdmin, providerError.code, refund.attempt_id, refund.provider_payment_id);
      return jsonResponse(request, { error: "Refund outcome is unknown", code: providerError.code }, 503);
    }
  }

  try {
    const synchronized = await synchronizeCurrentState({
      supabaseAdmin,
      accessToken,
      paymentId: refund.provider_payment_id,
    });
    if (isReversed(synchronized)) {
      await finishRefund(supabaseAdmin, refund.request_id, "synchronized", providerRefundId, null);
      return jsonResponse(request, {
        ok: true,
        synchronized: true,
        provider_status: synchronized.provider_status ?? null,
      });
    }

    await finishRefund(
      supabaseAdmin,
      refund.request_id,
      "provider_accepted",
      providerRefundId,
      "awaiting_provider_state",
    );
    return jsonResponse(request, {
      ok: true,
      pending: true,
      synchronized: false,
      provider_status: synchronized.provider_status ?? null,
    }, 202);
  } catch (error) {
    const syncError = error instanceof PaymentSyncError
      ? error
      : new PaymentSyncError("post_refund_sync_failed", "Unable to synchronize accepted refund");
    await finishRefund(
      supabaseAdmin,
      refund.request_id,
      "provider_accepted",
      providerRefundId,
      syncError.code,
    );
    await recordReconciliationFailure(supabaseAdmin, refund.attempt_id, syncError.code);
    return jsonResponse(request, {
      ok: true,
      pending: true,
      synchronized: false,
      code: syncError.code,
    }, 202);
  }
});
