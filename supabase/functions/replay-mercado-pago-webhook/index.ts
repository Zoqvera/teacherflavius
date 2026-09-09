import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  getDefaultKey,
  JsonRecord,
  PaymentSyncError,
  synchronizeMercadoPagoPayment,
} from "../_shared/mercado_pago_payment_sync.ts";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);

type WebhookEvent = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  event_type: string | null;
  status: string;
  last_processing_started_at: string | null;
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isProcessingFresh(value: string | null): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 120_000;
}

async function recordGatewayFailure(
  supabaseAdmin: ReturnType<typeof createClient>,
  code: string,
  providerPaymentId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_payment_operational_event", {
    target_event_type: "gateway_failure",
    target_event_code: `replay_${code}`.slice(0, 160),
    target_attempt_id: null,
    target_provider_payment_id: providerPaymentId,
    target_details: { source: "webhook_replay" },
  });
  if (error) console.error("Unable to record replay gateway failure", error.message);
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
  const mercadoPagoAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
  const authorization = request.headers.get("authorization") ?? "";

  if (!supabaseUrl || !anonKey || !secretKey || !mercadoPagoAccessToken || !authorization) {
    return jsonResponse(request, { error: "Server configuration is incomplete" }, 500);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminError } = await userClient.rpc("is_teacher_admin_mfa");
  if (adminError || isAdmin !== true) {
    return jsonResponse(request, { error: "Administrative MFA is required" }, 403);
  }

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonRecord
      : {};
  } catch {
    return jsonResponse(request, { error: "Invalid JSON body" }, 400);
  }

  const eventId = body.event_id;
  if (!isUuid(eventId)) {
    return jsonResponse(request, { error: "Invalid webhook event ID" }, 400);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: event, error: eventError } = await supabaseAdmin
    .from("payment_webhook_events")
    .select("id, provider, provider_payment_id, event_type, status, last_processing_started_at")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    console.error("Unable to load webhook event for replay", eventError.message);
    return jsonResponse(request, { error: "Unable to load webhook event" }, 500);
  }
  if (!event) return jsonResponse(request, { error: "Webhook event not found" }, 404);

  const webhookEvent = event as WebhookEvent;
  if (
    webhookEvent.provider !== "mercado_pago" ||
    webhookEvent.event_type !== "payment" ||
    !webhookEvent.provider_payment_id
  ) {
    return jsonResponse(request, { error: "Webhook event is not replayable" }, 422);
  }
  if (
    webhookEvent.status === "processing" &&
    isProcessingFresh(webhookEvent.last_processing_started_at)
  ) {
    return jsonResponse(request, { error: "Webhook event is already processing" }, 409);
  }

  const { error: beginError } = await supabaseAdmin.rpc("begin_mercado_pago_webhook_processing", {
    target_event_id: webhookEvent.id,
    target_is_replay: true,
  });
  if (beginError) {
    const status = beginError.message.includes("já está em processamento") ? 409 : 500;
    return jsonResponse(request, { error: "Unable to start webhook replay" }, status);
  }

  try {
    const result = await synchronizeMercadoPagoPayment({
      supabaseAdmin,
      accessToken: mercadoPagoAccessToken,
      paymentId: webhookEvent.provider_payment_id,
    });
    const { error: finishError } = await supabaseAdmin.rpc("finish_mercado_pago_webhook_event", {
      target_event_id: webhookEvent.id,
      target_status: "processed",
      target_error: null,
    });
    if (finishError) throw new Error(finishError.message);

    return jsonResponse(request, {
      ok: true,
      event_id: webhookEvent.id,
      provider_payment_id: webhookEvent.provider_payment_id,
      provider_status: result.provider_status ?? null,
      payment_applied: result.payment_applied === true,
      payment_reversed: result.payment_reversed === true,
      duplicate_payment_detected: result.duplicate_payment_detected === true,
    });
  } catch (error) {
    const syncError = error instanceof PaymentSyncError
      ? error
      : new PaymentSyncError("unexpected_replay_error", "Unexpected replay failure");

    const { error: finishError } = await supabaseAdmin.rpc("finish_mercado_pago_webhook_event", {
      target_event_id: webhookEvent.id,
      target_status: "failed",
      target_error: syncError.code,
    });
    if (finishError) console.error("Unable to mark replay failure", finishError.message);

    if (syncError.code.startsWith("gateway_")) {
      await recordGatewayFailure(
        supabaseAdmin,
        syncError.code,
        webhookEvent.provider_payment_id,
      );
    }
    console.error("Mercado Pago webhook replay failed", webhookEvent.id, syncError.code);
    return jsonResponse(
      request,
      { error: "Unable to replay webhook", code: syncError.code },
      502,
    );
  }
});
