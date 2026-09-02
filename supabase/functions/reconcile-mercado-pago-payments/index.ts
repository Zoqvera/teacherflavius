import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type PaymentAttempt = {
  id: string;
  tuition_id: string;
  student_id: string;
  provider_payment_id: string | null;
  amount: number | string;
  status: string;
};

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

const ACTIVE_ATTEMPT_STATUSES = [
  "created",
  "pending",
  "authorized",
  "in_process",
  "in_mediation",
];

const KNOWN_PAYMENT_STATUSES = new Set([
  ...ACTIVE_ATTEMPT_STATUSES,
  "approved",
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

function getAllowedOrigin(request: Request): string {
  const configuredOrigin = (Deno.env.get("SITE_URL") ?? "https://teacherflavius.com").replace(/\/$/, "");
  const origin = request.headers.get("Origin") ?? "";
  return origin === configuredOrigin || origin === "https://www.teacherflavius.com"
    ? origin
    : configuredOrigin;
}

function responseHeaders(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(request),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

async function fetchMercadoPagoPayment(
  accessToken: string,
  providerPaymentId: string,
): Promise<MercadoPagoPayment> {
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(providerPaymentId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Mercado Pago payment lookup failed with HTTP ${response.status}`);
  }

  return await response.json() as MercadoPagoPayment;
}

function validateProviderPayment(attempt: PaymentAttempt, payment: MercadoPagoPayment): void {
  const providerPaymentId = payment.id != null ? String(payment.id) : "";
  const externalReference = cleanString(payment.external_reference, 36);
  const amount = Number(payment.transaction_amount);

  if (
    !attempt.provider_payment_id
    || providerPaymentId !== String(attempt.provider_payment_id)
    || externalReference !== attempt.id
    || !Number.isFinite(amount)
    || amount <= 0
    || amount.toFixed(2) !== Number(attempt.amount).toFixed(2)
  ) {
    throw new Error("Mercado Pago returned inconsistent payment data");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método não permitido." }, 405);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) {
    return jsonResponse(request, { error: "Requisição muito grande." }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
  const authorization = request.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !anonKey || !secretKey || !mercadoPagoAccessToken) {
    console.error("Server environment is incomplete for Mercado Pago reconciliation");
    return jsonResponse(request, { error: "Configuração do servidor incompleta." }, 500);
  }

  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse(request, { error: "É necessário entrar na conta." }, 401);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const supabaseAuth = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) {
    return jsonResponse(request, { error: "Sessão inválida ou expirada." }, 401);
  }

  let body: JsonRecord = {};
  try {
    const rawBody = await request.text();
    if (rawBody) {
      const parsed = JSON.parse(rawBody);
      if (!isRecord(parsed)) throw new Error("Invalid body");
      body = parsed;
    }
  } catch {
    return jsonResponse(request, { error: "Corpo JSON inválido." }, 400);
  }

  const tuitionId = cleanString(body.tuition_id, 36);
  if (tuitionId && !isUuid(tuitionId)) {
    return jsonResponse(request, { error: "Mensalidade inválida." }, 422);
  }

  const { data: isAdminData, error: adminError } = await supabaseAuth.rpc("is_teacher_admin");
  if (adminError) {
    console.error("Unable to verify teacher admin access", adminError.message);
    return jsonResponse(request, { error: "Não foi possível verificar a autorização." }, 500);
  }
  const isAdmin = isAdminData === true;

  let attemptsQuery = supabaseAdmin
    .from("tuition_payment_attempts")
    .select("id, tuition_id, student_id, provider_payment_id, amount, status")
    .in("status", ACTIVE_ATTEMPT_STATUSES)
    .not("provider_payment_id", "is", null)
    .order("updated_at", { ascending: false })
    .limit(isAdmin ? 25 : 10);

  if (!isAdmin) attemptsQuery = attemptsQuery.eq("student_id", user.id);
  if (tuitionId) attemptsQuery = attemptsQuery.eq("tuition_id", tuitionId);

  const { data: attempts, error: attemptsError } = await attemptsQuery;
  if (attemptsError) {
    console.error("Unable to load pending Mercado Pago attempts", attemptsError.message);
    return jsonResponse(request, { error: "Não foi possível consultar pagamentos pendentes." }, 500);
  }

  const summary = {
    checked: 0,
    synchronized: 0,
    approved: 0,
    pending: 0,
    failed: 0,
  };

  for (const attempt of (attempts ?? []) as PaymentAttempt[]) {
    if (!attempt.provider_payment_id) continue;
    summary.checked += 1;

    try {
      const payment = await fetchMercadoPagoPayment(mercadoPagoAccessToken, attempt.provider_payment_id);
      validateProviderPayment(attempt, payment);

      const status = normalizeStatus(payment.status);
      const amount = Number(payment.transaction_amount);
      const { error: processError } = await supabaseAdmin.rpc("process_mercado_pago_payment", {
        target_attempt_id: attempt.id,
        target_provider_payment_id: String(payment.id),
        target_status: status,
        target_status_detail: cleanString(payment.status_detail, 300) || null,
        target_amount: amount,
        target_payment_method: normalizePaymentMethod(payment),
        target_live_mode: payment.live_mode === true,
        target_provider_created_at: safeDate(payment.date_created),
        target_provider_updated_at: safeDate(payment.date_last_updated),
        target_approved_at: safeDate(payment.date_approved),
      });

      if (processError) throw new Error(processError.message);
      summary.synchronized += 1;
      if (status === "approved") summary.approved += 1;
      if (ACTIVE_ATTEMPT_STATUSES.includes(status)) summary.pending += 1;
    } catch (error) {
      summary.failed += 1;
      console.error(
        "Unable to reconcile Mercado Pago payment",
        attempt.id,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return jsonResponse(request, { ok: true, ...summary });
});
