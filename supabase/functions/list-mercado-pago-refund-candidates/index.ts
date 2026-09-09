import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { getDefaultKey, JsonRecord } from "../_shared/mercado_pago_payment_sync.ts";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);

type RefundCandidate = {
  tuition_id?: string;
  amount_paid?: number | string;
  refund_status?: string | null;
  refund_attempt_count?: number | string;
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

function normalizeReferenceMonth(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-01$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : value;
}

function publicCandidate(row: RefundCandidate): JsonRecord | null {
  if (typeof row.tuition_id !== "string" || !row.tuition_id) return null;
  return {
    tuition_id: row.tuition_id,
    amount_paid: Number(row.amount_paid || 0),
    refund_status: typeof row.refund_status === "string" ? row.refund_status : null,
    refund_attempt_count: Number(row.refund_attempt_count || 0),
  };
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

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    body = isRecord(parsed) ? parsed : {};
  } catch {
    return jsonResponse(request, { error: "Invalid JSON body" }, 400);
  }
  const referenceMonth = normalizeReferenceMonth(body.reference_month);
  if (!referenceMonth) {
    return jsonResponse(request, { error: "Invalid reference month" }, 400);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: isAdmin, error: adminError } = await userClient.rpc("is_teacher_admin_mfa");
  if (adminError || isAdmin !== true) {
    return jsonResponse(request, { error: "Administrative MFA is required" }, 403);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc("list_mercado_pago_refund_candidates", {
    target_reference_month: referenceMonth,
  });
  if (error) {
    console.error("Unable to list Mercado Pago refund candidates", error.message);
    return jsonResponse(request, { error: "Unable to list refund candidates" }, 500);
  }

  const candidates = (Array.isArray(data) ? data : [])
    .map((row) => publicCandidate(row as RefundCandidate))
    .filter((row): row is JsonRecord => row !== null);
  return jsonResponse(request, { ok: true, candidates });
});
