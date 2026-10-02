import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  getDefaultKey,
  JsonRecord,
  PaymentSyncError,
  synchronizeMercadoPagoPayment,
} from "../_shared/mercado_pago_payment_sync.ts";
import {
  SubscriptionSyncError,
  synchronizeMercadoPagoAuthorizedPayment,
  synchronizeMercadoPagoSubscription,
  trySynchronizeMercadoPagoSubscriptionPayment,
} from "../_shared/mercado_pago_subscription_sync.ts";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);
const SUBSCRIPTION_EVENT_TYPE = "subscription_preapproval";
const AUTHORIZED_PAYMENT_EVENT_TYPE = "subscription_authorized_payment";

type WebhookEvent = {
  id: string;
  provider: string;
  provider_payment_id: string | null;
  event_type: string | null;
  status: string;
  last_processing_started_at: string | null;
  metadata: JsonRecord | null;
};

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://teacherflavius.com",
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
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function cleanIdentifier(value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    return "";
  }
  return String(value).trim().slice(0, 128);
}

function isProcessingFresh(value: string | null): boolean {
  if (!value) return false;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Date.now() - timestamp < 120_000;
}

function replayError(error: unknown): PaymentSyncError | SubscriptionSyncError {
  if (error instanceof PaymentSyncError || error instanceof SubscriptionSyncError) {
    return error;
  }
  return new SubscriptionSyncError("unexpected_replay_error", "Unexpected replay failure");
}

async function recordGatewayFailure(
  supabaseAdmin: ReturnType<typeof createClient>,
  code: string,
  providerPaymentId: string | null,
  eventType: string,
  providerResourceId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("record_payment_operational_event", {
    target_event_type: "gateway_failure",
    target_event_code: `replay_${code}`.slice(0, 160),
    target_attempt_id: null,
    target_provider_payment_id: providerPaymentId,
    target_details: {
      source: "webhook_replay",
      event_type: eventType,
      provider_resource_id: providerResourceId || null,
    },
  });

  if (error) console.error("Unable to record replay gateway failure", error.message);
}

async function replayPayment(options: {
  supabaseAdmin: ReturnType<typeof createClient>;
  accessToken: string;
  paymentId: string;
}): Promise<JsonRecord> {
  try {
    return await synchronizeMercadoPagoPayment(options);
  } catch (error) {
    if (
      !(error instanceof PaymentSyncError)
      || !["attempt_mismatch", "attempt_load_failed"].includes(error.code)
    ) {
      throw error;
    }

    const subscriptionResult = await trySynchronizeMercadoPagoSubscriptionPayment(options);
    if (subscriptionResult) return subscriptionResult;
    throw error;
  }
}

async function replayProviderState(options: {
  supabaseAdmin: ReturnType<typeof createClient>;
  accessToken: string;
  eventType: string;
  providerPaymentId: string;
  providerResourceId: string;
}): Promise<JsonRecord> {
  if (options.eventType === SUBSCRIPTION_EVENT_TYPE) {
    return await synchronizeMercadoPagoSubscription({
      supabaseAdmin: options.supabaseAdmin,
      accessToken: options.accessToken,
      subscriptionId: options.providerResourceId,
    });
  }

  if (options.eventType === AUTHORIZED_PAYMENT_EVENT_TYPE) {
    return await synchronizeMercadoPagoAuthorizedPayment({
      supabaseAdmin: options.supabaseAdmin,
      accessToken: options.accessToken,
      authorizedPaymentId: options.providerResourceId,
    });
  }

  return await replayPayment({
    supabaseAdmin: options.supabaseAdmin,
    accessToken: options.accessToken,
    paymentId: options.providerPaymentId,
  });
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
  const { data: isAdmin, error: adminError } = await userClient.rpc("is_teacher_admin");
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
    .select(
      "id, provider, provider_payment_id, event_type, status, last_processing_started_at, metadata",
    )
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    console.error("Unable to load webhook event for replay", eventError.message);
    return jsonResponse(request, { error: "Unable to load webhook event" }, 500);
  }
  if (!event) return jsonResponse(request, { error: "Webhook event not found" }, 404);

  const webhookEvent = event as WebhookEvent;
  const eventType = webhookEvent.event_type || "payment";
  const providerResourceId = cleanIdentifier(webhookEvent.metadata?.provider_resource_id);
  const providerPaymentId = cleanIdentifier(webhookEvent.provider_payment_id);
  const replayable = webhookEvent.provider === "mercado_pago"
    && ["payment", SUBSCRIPTION_EVENT_TYPE, AUTHORIZED_PAYMENT_EVENT_TYPE].includes(eventType);

  if (!replayable) {
    return jsonResponse(request, { error: "Webhook event is not replayable" }, 422);
  }

  if (eventType === "payment" && !providerPaymentId) {
    return jsonResponse(request, { error: "Webhook payment ID is missing" }, 422);
  }

  if (
    [SUBSCRIPTION_EVENT_TYPE, AUTHORIZED_PAYMENT_EVENT_TYPE].includes(eventType)
    && !providerResourceId
  ) {
    return jsonResponse(request, { error: "Webhook subscription resource ID is missing" }, 422);
  }

  if (
    webhookEvent.status === "processing"
    && isProcessingFresh(webhookEvent.last_processing_started_at)
  ) {
    return jsonResponse(request, { error: "Webhook event is already processing" }, 409);
  }

  const { error: beginError } = await supabaseAdmin.rpc(
    "begin_mercado_pago_webhook_processing",
    {
      target_event_id: webhookEvent.id,
      target_is_replay: true,
    },
  );
  if (beginError) {
    const status = beginError.message.includes("já está em processamento") ? 409 : 500;
    return jsonResponse(request, { error: "Unable to start webhook replay" }, status);
  }

  try {
    const result = await replayProviderState({
      supabaseAdmin,
      accessToken: mercadoPagoAccessToken,
      eventType,
      providerPaymentId,
      providerResourceId,
    });

    const { error: finishError } = await supabaseAdmin.rpc(
      "finish_mercado_pago_webhook_event",
      {
        target_event_id: webhookEvent.id,
        target_status: "processed",
        target_error: null,
      },
    );
    if (finishError) throw new Error(finishError.message);

    return jsonResponse(request, {
      ok: true,
      event_id: webhookEvent.id,
      event_type: eventType,
      provider_payment_id: providerPaymentId || null,
      provider_resource_id: providerResourceId || null,
      provider_status: result.provider_status ?? null,
      payment_applied: result.payment_applied === true,
      payment_reversed: result.payment_reversed === true,
      payment_reinstated: result.payment_reinstated === true,
      duplicate_payment_detected: result.duplicate_payment_detected === true,
      conflict_code: result.conflict_code ?? null,
    });
  } catch (error) {
    const syncError = replayError(error);

    const { error: finishError } = await supabaseAdmin.rpc(
      "finish_mercado_pago_webhook_event",
      {
        target_event_id: webhookEvent.id,
        target_status: "failed",
        target_error: syncError.code,
      },
    );
    if (finishError) console.error("Unable to mark replay failure", finishError.message);

    if (syncError.code.startsWith("gateway_")) {
      await recordGatewayFailure(
        supabaseAdmin,
        syncError.code,
        providerPaymentId || null,
        eventType,
        providerResourceId,
      );
    }

    console.error("Mercado Pago webhook replay failed", webhookEvent.id, syncError.code);
    return jsonResponse(
      request,
      { error: "Unable to replay webhook", code: syncError.code },
      syncError.code.startsWith("gateway_") ? 502 : 422,
    );
  }
});
