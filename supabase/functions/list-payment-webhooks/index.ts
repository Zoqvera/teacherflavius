import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { getDefaultKey, JsonRecord } from "../_shared/mercado_pago_payment_sync.ts";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);

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

function normalizeLimit(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 15;
  return Math.max(1, Math.min(Math.trunc(numeric), 50));
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
  const authorization = request.headers.get("authorization") ?? "";

  if (!supabaseUrl || !anonKey || !secretKey || !authorization) {
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

  let limit = 15;
  try {
    const body = await request.json() as JsonRecord;
    limit = normalizeLimit(body?.limit);
  } catch {
    // The default limit is sufficient when the optional body is omitted.
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabaseAdmin
    .from("payment_webhook_events")
    .select(
      "id, provider_payment_id, event_type, action, status, delivery_count, processing_attempts, replay_count, last_error, first_received_at, last_received_at, last_processing_started_at, processed_at",
    )
    .order("last_received_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Unable to load payment webhook audit", error.message);
    return jsonResponse(request, { error: "Unable to load payment webhook audit" }, 500);
  }

  const events = (data ?? []).map((event) => ({
    event_id: event.id,
    provider_payment_id: event.provider_payment_id,
    event_type: event.event_type,
    action: event.action,
    status: event.status,
    delivery_count: event.delivery_count,
    processing_attempts: event.processing_attempts,
    replay_count: event.replay_count,
    last_error: event.last_error,
    first_received_at: event.first_received_at,
    last_received_at: event.last_received_at,
    last_processing_started_at: event.last_processing_started_at,
    processed_at: event.processed_at,
  }));

  return jsonResponse(request, { ok: true, events });
});
