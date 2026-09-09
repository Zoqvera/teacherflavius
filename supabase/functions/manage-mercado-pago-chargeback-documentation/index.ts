import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { cleanString, getDefaultKey, JsonRecord } from "../_shared/mercado_pago_payment_sync.ts";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SUBMISSION_CONFIRMATION = "DOCUMENTAÇÃO ENVIADA";

type RpcCommand = { name: string; args: JsonRecord };

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

function uuid(value: unknown): string {
  const text = cleanString(value, 36);
  return UUID_PATTERN.test(text) ? text : "";
}

function bearerToken(authorization: string): string {
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : "";
}

async function adminActorId(options: {
  supabaseUrl: string;
  anonKey: string;
  authorization: string;
}): Promise<string> {
  const token = bearerToken(options.authorization);
  if (!token) return "";

  const client = createClient(options.supabaseUrl, options.anonKey, {
    global: { headers: { Authorization: options.authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: isAdmin, error: adminError }, userResult] = await Promise.all([
    client.rpc("is_teacher_admin_mfa"),
    client.auth.getUser(token),
  ]);
  if (adminError || isAdmin !== true || userResult.error || !userResult.data.user?.id) return "";
  return userResult.data.user.id;
}

function buildCommand(action: string, body: JsonRecord, actorId: string): RpcCommand | null {
  if (action === "get_case") {
    const chargebackId = uuid(body.chargeback_id);
    return chargebackId
      ? { name: "get_mercado_pago_chargeback_documentation", args: { target_chargeback_id: chargebackId } }
      : null;
  }

  if (action === "save_case") {
    const chargebackId = uuid(body.chargeback_id);
    if (!chargebackId) return null;
    return {
      name: "save_mercado_pago_chargeback_documentation_case",
      args: {
        target_chargeback_id: chargebackId,
        target_preparation_status: cleanString(body.preparation_status, 40),
        target_internal_notes: cleanString(body.internal_notes, 4000) || null,
        target_actor_user_id: actorId,
      },
    };
  }

  if (action === "add_evidence") {
    const chargebackId = uuid(body.chargeback_id);
    if (!chargebackId) return null;
    return {
      name: "add_mercado_pago_chargeback_evidence",
      args: {
        target_chargeback_id: chargebackId,
        target_category: cleanString(body.category, 60),
        target_label: cleanString(body.label, 180),
        target_notes: cleanString(body.notes, 2000) || null,
        target_actor_user_id: actorId,
      },
    };
  }

  if (action === "update_evidence") {
    const evidenceId = uuid(body.evidence_id);
    if (!evidenceId) return null;
    return {
      name: "update_mercado_pago_chargeback_evidence",
      args: {
        target_evidence_id: evidenceId,
        target_status: cleanString(body.status, 40),
        target_label: cleanString(body.label, 180),
        target_notes: cleanString(body.notes, 2000) || null,
        target_actor_user_id: actorId,
      },
    };
  }

  if (action === "delete_evidence") {
    const evidenceId = uuid(body.evidence_id);
    return evidenceId
      ? {
        name: "delete_mercado_pago_chargeback_evidence",
        args: { target_evidence_id: evidenceId, target_actor_user_id: actorId },
      }
      : null;
  }

  if (action === "mark_submitted") {
    const chargebackId = uuid(body.chargeback_id);
    if (!chargebackId || cleanString(body.confirmation, 80) !== SUBMISSION_CONFIRMATION) return null;
    return {
      name: "mark_mercado_pago_chargeback_documentation_submitted",
      args: { target_chargeback_id: chargebackId, target_actor_user_id: actorId },
    };
  }

  return null;
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

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) throw new Error("Invalid JSON");
    body = parsed;
  } catch {
    return jsonResponse(request, { error: "Invalid JSON body" }, 400);
  }

  const actorId = await adminActorId({ supabaseUrl, anonKey, authorization });
  if (!actorId) return jsonResponse(request, { error: "Administrative MFA is required" }, 403);

  const action = cleanString(body.action, 40).toLowerCase();
  const command = buildCommand(action, body, actorId);
  if (!command) return jsonResponse(request, { error: "Invalid documentation command" }, 400);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.rpc(command.name, command.args);
  if (error) {
    console.error("Chargeback documentation command failed", action, error.message);
    const status = error.code === "P0002" ? 404 : error.code === "22023" ? 409 : 500;
    return jsonResponse(request, { error: "Unable to update chargeback documentation", code: error.code ?? null }, status);
  }
  if (action === "get_case" && data == null) return jsonResponse(request, { error: "Chargeback not found" }, 404);

  return jsonResponse(request, { ok: true, result: data ?? null });
});
