import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  getDefaultKey,
  synchronizeMercadoPagoPayment,
} from "../_shared/mercado_pago_payment_sync.ts";

type JsonRecord = Record<string, unknown>;
type Attempt = {
  id: string;
  student_id: string;
  tuition_id: string;
  provider_payment_id: string;
  amount: number | string;
  live_mode: boolean | null;
  status: string;
  payment_method: string;
  applied_at: string | null;
  reversed_at: string | null;
};
type ProviderPayment = {
  id?: string | number;
  external_reference?: string;
  transaction_amount?: number | string;
  currency_id?: string;
  payment_method_id?: string;
  payment_type_id?: string;
  status?: string;
  live_mode?: boolean;
};
type AdminClient = ReturnType<typeof createClient>;

const ORIGINS = new Set(["https://teacherflavius.com", "https://www.teacherflavius.com"]);
const CANCELLABLE = new Set(["pending", "in_process", "authorized"]);
const CONFIRMATION = "CANCELAR";
const TIMEOUT_MS = 10_000;
const PROVIDER_URL = "https://api.mercadopago.com/v1/payments/";
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.has(origin) ? origin : "https://teacherflavius.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

function respond(request: Request, data: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function normalizeToken(raw: string): string {
  return raw.trim().replace(/^MERCADO_PAGO_ACCESS_TOKEN\s*=\s*/i, "")
    .replace(/^Bearer\s+/i, "").replace(/^["']|["']$/g, "").trim();
}

function validAttempt(row: Attempt): boolean {
  return !!row && ID_PATTERN.test(row.id) && /^\d{8,20}$/.test(row.provider_payment_id)
    && row.payment_method === "pix" && row.applied_at === null && row.reversed_at === null
    && CANCELLABLE.has(row.status);
}

function verifyProvider(row: Attempt, payment: ProviderPayment): boolean {
  const amount = Number(payment.transaction_amount);
  return String(payment.id ?? "") === row.provider_payment_id
    && payment.external_reference === row.id
    && Number.isFinite(amount) && amount > 0
    && amount.toFixed(2) === Number(row.amount).toFixed(2)
    && payment.currency_id === "BRL"
    && (payment.payment_method_id === "pix" || payment.payment_type_id === "bank_transfer")
    && (typeof row.live_mode !== "boolean" || payment.live_mode === row.live_mode);
}

async function providerRequest(
  token: string,
  paymentId: string,
  method: "GET" | "PUT",
): Promise<{ ok: boolean; status: number; payment: ProviderPayment | null }> {
  const response = await fetch(PROVIDER_URL + encodeURIComponent(paymentId), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(method === "PUT" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "PUT" ? { body: JSON.stringify({ status: "cancelled" }) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const payload: unknown = await response.json().catch(() => null);
  return {
    ok: response.ok,
    status: response.status,
    payment: payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as ProviderPayment : null,
  };
}

async function logCancellation(
  admin: AdminClient, row: Attempt, actorId: string, outcome: string,
  providerStatus: string | null, errorCode: string | null = null,
): Promise<void> {
  const { error } = await admin.from("payment_cancellation_audit").insert({
    attempt_id: row.id,
    actor_id: actorId,
    provider_payment_id: row.provider_payment_id,
    outcome,
    provider_status: providerStatus,
    error_code: errorCode,
  });
  if (error) throw new Error("audit_write_failed");
}

async function getAttempt(admin: AdminClient, id: string): Promise<Attempt | null> {
  const { data, error } = await admin.from("tuition_payment_attempts")
    .select("id,student_id,tuition_id,provider_payment_id,amount,live_mode,status,payment_method,applied_at,reversed_at")
    .eq("id", id).maybeSingle();
  if (error) throw new Error("attempt_query_failed");
  return data as Attempt | null;
}

async function listCandidates(admin: AdminClient, month: string): Promise<JsonRecord[]> {
  const { data, error } = await admin.from("tuition_payment_attempts")
    .select("id,student_id,tuition_id,provider_payment_id,amount,live_mode,status,payment_method,applied_at,reversed_at")
    .eq("provider", "mercado_pago").eq("payment_method", "pix")
    .in("status", [...CANCELLABLE]).not("provider_payment_id", "is", null)
    .is("applied_at", null).is("reversed_at", null).order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error("attempt_list_failed");
  const rows = ((data ?? []) as Attempt[]).filter(validAttempt);
  if (!rows.length) return [];

  const { data: tuitions, error: tuitionError } = await admin.from("monthly_tuition")
    .select("id,reference_month,amount_due,amount_paid,payment_date")
    .in("id", [...new Set(rows.map((row) => row.tuition_id))]);
  if (tuitionError) throw new Error("tuition_list_failed");
  const tuitionById = new Map((tuitions ?? []).map((item) => [item.id, item]));
  const matches = rows.filter((row) => tuitionById.get(row.tuition_id)?.reference_month === month);
  if (!matches.length) return [];

  const { data: students, error: studentsError } = await admin.from("profiles")
    .select("id,name").in("id", [...new Set(matches.map((row) => row.student_id))]);
  if (studentsError) throw new Error("student_list_failed");
  const studentById = new Map((students ?? []).map((item) => [item.id, item.name]));
  return matches.map((row) => {
    const tuition = tuitionById.get(row.tuition_id);
    return {
      attempt_id: row.id,
      student_name: studentById.get(row.student_id) ?? "Aluno",
      reference_month: tuition?.reference_month ?? month,
      amount: Number(row.amount),
      amount_due: Number(tuition?.amount_due ?? 0),
      amount_paid: tuition?.amount_paid == null ? null : Number(tuition.amount_paid),
      tuition_paid: tuition?.payment_date != null,
      provider_payment_id: row.provider_payment_id,
      status: row.status,
    };
  });
}

async function synchronizeCancelled(admin: AdminClient, token: string, row: Attempt): Promise<void> {
  const result = await synchronizeMercadoPagoPayment({
    supabaseAdmin: admin,
    accessToken: token,
    paymentId: row.provider_payment_id,
  });
  if (result.provider_status !== "cancelled") throw new Error("cancel_sync_mismatch");
}

async function cancelAttempt(
  request: Request, admin: AdminClient, token: string, actorId: string, attemptId: string,
): Promise<Response> {
  const attempt = await getAttempt(admin, attemptId);
  if (!attempt || !validAttempt(attempt)) {
    return respond(request, { error: "Tentativa indisponível para cancelamento." }, 409);
  }

  const current = await providerRequest(token, attempt.provider_payment_id, "GET");
  if (!current.ok || !current.payment || !verifyProvider(attempt, current.payment)) {
    return respond(request, { error: "Não foi possível validar a cobrança no Mercado Pago." }, 502);
  }
  const status = cleanString(current.payment.status, 30);
  if (status === "cancelled") {
    await synchronizeCancelled(admin, token, attempt);
    await logCancellation(admin, attempt, actorId, "already_cancelled", status);
    return respond(request, { ok: true, already_cancelled: true, provider_status: "cancelled" });
  }
  if (!CANCELLABLE.has(status)) {
    await logCancellation(admin, attempt, actorId, "blocked", status, "not_cancellable");
    return respond(request, {
      error: "A cobrança mudou de estado; o cancelamento não foi solicitado.",
      provider_status: status,
    }, 409);
  }

  // Fail closed if the audit record cannot be saved before the provider call.
  await logCancellation(admin, attempt, actorId, "requested", status);
  let providerOutcome = "uncertain";
  try {
    const result = await providerRequest(token, attempt.provider_payment_id, "PUT");
    if (result.ok && result.payment?.status === "cancelled"
      && verifyProvider(attempt, result.payment)) {
      providerOutcome = "cancelled";
    }
  } catch (_) {
    // A timeout is ambiguous: the provider may already have accepted cancellation.
  }

  if (providerOutcome !== "cancelled") {
    try {
      const verified = await providerRequest(token, attempt.provider_payment_id, "GET");
      if (verified.ok && verified.payment && verifyProvider(attempt, verified.payment)) {
        providerOutcome = cleanString(verified.payment.status, 30);
      }
    } catch (_) {
      // Do not retry a potentially accepted payment mutation blindly.
    }
  }

  if (providerOutcome !== "cancelled") {
    await logCancellation(admin, attempt, actorId, "uncertain", providerOutcome, "provider_unconfirmed");
    return respond(request, {
      error: "Cancelamento não confirmado. Verifique novamente o estado do pagamento.",
      provider_status: providerOutcome,
    }, 409);
  }

  try {
    await synchronizeCancelled(admin, token, attempt);
    await logCancellation(admin, attempt, actorId, "confirmed", "cancelled");
    return respond(request, { ok: true, provider_status: "cancelled" });
  } catch (_) {
    await logCancellation(admin, attempt, actorId, "uncertain", "cancelled", "local_sync_pending");
    return respond(request, {
      error: "O Mercado Pago confirmou o cancelamento; a sincronização local ainda precisa ser conferida.",
      provider_status: "cancelled",
      pending_sync: true,
    }, 202);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") return respond(request, { error: "Método não permitido." }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const token = normalizeToken(Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "");
  const authorization = request.headers.get("authorization") ?? "";
  if (!url || !anonKey || !serviceKey || !token || !authorization) {
    return respond(request, { error: "Configuração de pagamentos indisponível." }, 500);
  }

  let body: JsonRecord;
  try {
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    body = payload as JsonRecord;
  } catch (_) {
    return respond(request, { error: "Requisição inválida." }, 400);
  }

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const [{ data: isAdmin, error: adminError }, { data: auth, error: userError }] = await Promise.all([
    userClient.rpc("is_teacher_admin"),
    userClient.auth.getUser(),
  ]);
  if (adminError || isAdmin !== true || userError || !auth.user?.id) {
    return respond(request, { error: "Acesso administrativo obrigatório." }, 403);
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (body.action === "list") {
      const month = body.reference_month;
      if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(month)) {
        return respond(request, { error: "Mês inválido." }, 400);
      }
      const candidates = await listCandidates(admin, month);
      return respond(request, { ok: true, candidates });
    }
    if (body.action === "cancel") {
      if (typeof body.attempt_id !== "string" || !ID_PATTERN.test(body.attempt_id)
        || cleanString(body.confirmation, 30).toUpperCase() !== CONFIRMATION) {
        return respond(request, { error: "Confirmação explícita obrigatória." }, 400);
      }
      return await cancelAttempt(request, admin, token, auth.user.id, body.attempt_id);
    }
    return respond(request, { error: "Operação inválida." }, 400);
  } catch (error) {
    const code = error instanceof Error ? error.message : "unexpected_failure";
    console.error("Pending Pix administrative operation failed:", code);
    return respond(request, { error: "Não foi possível concluir a operação com segurança." }, 502);
  }
});
