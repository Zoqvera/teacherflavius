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

function normalizeReferenceMonth(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-01$/.test(trimmed) ? trimmed : null;
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (request.method !== "POST") return jsonResponse(request, { error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization") ?? "";
  if (!supabaseUrl || !anonKey || !secretKey || !authorization) {
    return jsonResponse(request, { error: "Server configuration is incomplete" }, 500);
  }

  let body: JsonRecord = {};
  try {
    const parsed = await request.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) body = parsed as JsonRecord;
  } catch {
    return jsonResponse(request, { error: "Invalid JSON body" }, 400);
  }
  const referenceMonth = normalizeReferenceMonth(body.reference_month);
  if (!referenceMonth) return jsonResponse(request, { error: "Invalid reference month" }, 400);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminError } = await userClient.rpc("is_teacher_admin_mfa");
  if (adminError || isAdmin !== true) {
    return jsonResponse(request, { error: "Administrative MFA is required" }, 403);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabaseAdmin.rpc("list_mercado_pago_chargeback_documentation_cases", {
    target_reference_month: referenceMonth,
  });
  if (error) {
    console.error("Unable to list Mercado Pago chargebacks", error.message);
    return jsonResponse(request, { error: "Unable to list chargebacks" }, 500);
  }

  const rows = (Array.isArray(data) ? data : []).map((row: JsonRecord) => ({
    case_id: row.chargeback_id ?? null,
    tuition_id: row.tuition_id ?? null,
    chargeback_id: row.provider_chargeback_id ?? null,
    amount: row.amount ?? null,
    currency: row.currency ?? null,
    reason: row.reason ?? null,
    coverage_eligible: row.coverage_eligible ?? null,
    documentation_status: row.documentation_status ?? null,
    documentation_deadline: row.documentation_deadline ?? null,
    operational_status: row.operational_status ?? "open",
    payment_status: row.payment_status ?? null,
    provider_created_at: row.provider_created_at ?? null,
    provider_updated_at: row.provider_updated_at ?? null,
    preparation_status: row.preparation_status ?? "not_started",
    submission_marked_at: row.submission_marked_at ?? null,
    evidence_total: row.evidence_total ?? 0,
    evidence_included: row.evidence_included ?? 0,
  }));

  return jsonResponse(request, { ok: true, chargebacks: rows });
});
