import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;
type SubscriptionStatus = "draft" | "pending" | "authorized" | "paused" | "cancelled";

type BillingSettings = {
  monthly_fee: number | string;
  due_day: number;
  active: boolean;
};

type ExistingSubscription = {
  id: string;
  provider_subscription_id: string | null;
  external_reference: string;
  idempotency_key: string;
  status: SubscriptionStatus;
  amount: number | string;
  due_day: number;
  first_charge_date: string;
  next_payment_date: string | null;
};

type MercadoPagoSubscription = {
  id?: string;
  status?: string;
  external_reference?: string;
  payer_id?: string | number;
  payment_method_id?: string;
  next_payment_date?: string;
  date_created?: string;
  last_modified?: string;
  live_mode?: boolean;
  init_point?: string;
  auto_recurring?: {
    transaction_amount?: number | string;
    currency_id?: string;
  };
};

const CURRENT_SUBSCRIPTION_STATUSES: SubscriptionStatus[] = [
  "draft",
  "pending",
  "authorized",
  "paused",
];

function getDefaultKey(envName: string, legacyName: string): string {
  const raw = Deno.env.get(envName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = parsed.default;
      if (typeof key === "string" && key) return key;
    } catch (_) {}
  }
  return Deno.env.get(legacyName) ?? "";
}

function normalizeAccessToken(value: string | undefined): string {
  let token = (value ?? "").trim();

  if (/^MERCADO_PAGO_ACCESS_TOKEN\s*=/i.test(token)) {
    token = token.replace(/^MERCADO_PAGO_ACCESS_TOKEN\s*=\s*/i, "").trim();
  }

  if (/^Bearer\s+/i.test(token)) {
    token = token.replace(/^Bearer\s+/i, "").trim();
  }

  const hasMatchingQuotes = (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  );
  if (hasMatchingQuotes) token = token.slice(1, -1).trim();

  return token;
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

function safeIsoDate(value: unknown): string | null {
  const text = cleanString(value, 80);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  const status = cleanString(value, 40).toLowerCase();
  if (status === "authorized" || status === "paused" || status === "cancelled") return status;
  return "pending";
}

function sanitizeProviderCode(value: unknown): string {
  return cleanString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getProviderErrorCode(payload: unknown): string {
  if (!isRecord(payload)) return "unknown";
  return sanitizeProviderCode(payload.error)
    || sanitizeProviderCode(payload.code)
    || "unknown";
}

function subscriptionsEnabled(): boolean {
  return (Deno.env.get("MERCADO_PAGO_SUBSCRIPTIONS_ENABLED") ?? "")
    .trim()
    .toLowerCase() === "true";
}

function getSaoPauloDateParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values: Record<string, number> = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }

  return {
    year: values.year,
    month: values.month,
    day: values.day,
  };
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function calculateFirstChargeDate(dueDay: number): string {
  const today = getSaoPauloDateParts();
  let year = today.year;
  let month = today.month + 1;

  if (month === 13) {
    month = 1;
    year += 1;
  }

  const day = Math.min(dueDay, lastDayOfMonth(year, month));
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function firstChargeIso(firstChargeDate: string): string {
  return firstChargeDate + "T12:00:00-03:00";
}

function publicSubscription(subscription: ExistingSubscription, reused = false): JsonRecord {
  return {
    ok: true,
    subscription_id: subscription.id,
    provider_subscription_id: subscription.provider_subscription_id,
    status: subscription.status,
    amount: Number(subscription.amount),
    currency_id: "BRL",
    due_day: subscription.due_day,
    first_charge_date: subscription.first_charge_date,
    next_payment_date: subscription.next_payment_date,
    reused,
  };
}

async function loadCurrentSubscription(
  supabaseAdmin: ReturnType<typeof createClient>,
  studentId: string,
): Promise<ExistingSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("student_subscriptions")
    .select(
      "id, provider_subscription_id, external_reference, idempotency_key, status, amount, due_day, first_charge_date, next_payment_date",
    )
    .eq("student_id", studentId)
    .in("status", CURRENT_SUBSCRIPTION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("Não foi possível consultar a assinatura atual.");
  return data as ExistingSubscription | null;
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
  const publishableKey = getDefaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = normalizeAccessToken(Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN"));
  const authorization = request.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Supabase environment is incomplete for subscription creation");
    return jsonResponse(request, { error: "Configuração do servidor incompleta." }, 500);
  }

  if (!authorization.startsWith("Bearer ")) {
    return jsonResponse(request, { error: "É necessário entrar na conta." }, 401);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const supabaseAuth = createClient(supabaseUrl, publishableKey, {
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

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) throw new Error("invalid body");
    body = parsed;
  } catch {
    return jsonResponse(request, { error: "Corpo JSON inválido." }, 400);
  }

  const action = cleanString(body.action, 30).toLowerCase();

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("id, email, enrolled, archived")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("Unable to load subscription profile", profileError.message);
    return jsonResponse(request, { error: "Não foi possível validar o cadastro do aluno." }, 500);
  }

  if (!profile || profile.enrolled !== true || profile.archived === true) {
    return jsonResponse(request, { error: "Aluno ativo não encontrado." }, 403);
  }

  const { data: billing, error: billingError } = await supabaseAdmin
    .from("student_billing_settings")
    .select("monthly_fee, due_day, active")
    .eq("student_id", user.id)
    .maybeSingle();

  if (billingError) {
    console.error("Unable to load subscription billing settings", billingError.message);
    return jsonResponse(request, { error: "Não foi possível consultar a mensalidade." }, 500);
  }

  const settings = billing as BillingSettings | null;
  const amount = Number(settings?.monthly_fee);
  const dueDay = Number(settings?.due_day);

  if (
    !settings
    || settings.active !== true
    || !Number.isFinite(amount)
    || amount <= 0
    || !Number.isInteger(dueDay)
    || dueDay < 1
    || dueDay > 31
  ) {
    return jsonResponse(request, {
      error: "A mensalidade precisa estar ativa, com valor e vencimento definidos.",
      code: "subscription_billing_not_ready",
    }, 409);
  }

  const payerEmail = cleanString(user.email || profile.email, 320).toLowerCase();
  if (!payerEmail || !payerEmail.includes("@")) {
    return jsonResponse(request, {
      error: "A conta precisa ter um e-mail válido para criar a assinatura.",
      code: "subscription_payer_email_missing",
    }, 409);
  }

  const firstChargeDate = calculateFirstChargeDate(dueDay);
  const currentSubscription = await loadCurrentSubscription(supabaseAdmin, user.id);

  if (action === "preview") {
    return jsonResponse(request, {
      ok: true,
      subscriptions_enabled: subscriptionsEnabled(),
      amount,
      currency_id: "BRL",
      due_day: dueDay,
      first_charge_date: firstChargeDate,
      frequency: 1,
      frequency_type: "months",
      current_subscription: currentSubscription
        ? publicSubscription(currentSubscription, true)
        : null,
    });
  }

  if (action !== "create") {
    return jsonResponse(request, { error: "Ação inválida." }, 400);
  }

  if (!subscriptionsEnabled()) {
    return jsonResponse(request, {
      error: "A criação de assinaturas ainda não foi liberada.",
      code: "subscriptions_not_enabled",
    }, 503);
  }

  if (!mercadoPagoAccessToken) {
    return jsonResponse(request, {
      error: "O Mercado Pago ainda não está configurado para assinaturas.",
      code: "mercado_pago_not_configured",
    }, 503);
  }

  if (currentSubscription?.provider_subscription_id) {
    return jsonResponse(request, publicSubscription(currentSubscription, true));
  }

  if (
    currentSubscription
    && (
      Number(currentSubscription.amount).toFixed(2) !== amount.toFixed(2)
      || currentSubscription.due_day !== dueDay
      || currentSubscription.first_charge_date !== firstChargeDate
    )
  ) {
    return jsonResponse(request, {
      error: "A configuração da mensalidade mudou após o início da assinatura. Revise o cadastro antes de tentar novamente.",
      code: "subscription_quote_changed",
    }, 409);
  }

  const cardTokenId = cleanString(body.card_token_id, 512);
  if (!cardTokenId || !/^[a-z0-9._-]+$/i.test(cardTokenId)) {
    return jsonResponse(request, {
      error: "Token do cartão inválido.",
      code: "subscription_card_token_invalid",
    }, 422);
  }

  let subscription = currentSubscription;
  if (!subscription) {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("student_subscriptions")
      .insert({
        student_id: user.id,
        amount,
        due_day: dueDay,
        first_charge_date: firstChargeDate,
        payer_email: payerEmail,
        status: "draft",
      })
      .select(
        "id, provider_subscription_id, external_reference, idempotency_key, status, amount, due_day, first_charge_date, next_payment_date",
      )
      .single();

    if (insertError || !inserted) {
      const concurrentSubscription = await loadCurrentSubscription(supabaseAdmin, user.id);
      if (concurrentSubscription) {
        return jsonResponse(request, publicSubscription(concurrentSubscription, true));
      }

      console.error("Unable to create subscription draft", insertError?.message);
      return jsonResponse(request, { error: "Não foi possível preparar a assinatura." }, 500);
    }

    subscription = inserted as ExistingSubscription;
  }

  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://teacherflavius.com").replace(/\/$/, "");
  const providerPayload = {
    reason: "Mensalidade Teacher Flavius",
    external_reference: subscription.external_reference,
    payer_email: payerEmail,
    card_token_id: cardTokenId,
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      start_date: firstChargeIso(subscription.first_charge_date),
      transaction_amount: Number(subscription.amount),
      currency_id: "BRL",
    },
    back_url: siteUrl + "/pagamento/?subscription=return",
    status: "authorized",
  };

  let providerResponse: Response;
  try {
    providerResponse = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + mercadoPagoAccessToken,
        "Content-Type": "application/json",
        "X-Idempotency-Key": subscription.idempotency_key,
      },
      body: JSON.stringify(providerPayload),
    });
  } catch (error) {
    console.error("Mercado Pago subscription request failed", error instanceof Error ? error.message : error);
    await supabaseAdmin
      .from("student_subscriptions")
      .update({
        last_provider_error_code: "network_error",
        last_provider_error_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);

    return jsonResponse(request, {
      error: "Não foi possível comunicar com o Mercado Pago.",
      code: "subscription_provider_unavailable",
    }, 502);
  }

  let providerBody: unknown = null;
  try {
    providerBody = await providerResponse.json();
  } catch (_) {}

  if (!providerResponse.ok) {
    const providerErrorCode = getProviderErrorCode(providerBody);
    console.error("Mercado Pago rejected subscription creation", providerResponse.status, providerErrorCode);

    await supabaseAdmin
      .from("student_subscriptions")
      .update({
        last_provider_error_code: providerErrorCode,
        last_provider_error_at: new Date().toISOString(),
      })
      .eq("id", subscription.id);

    return jsonResponse(request, {
      error: "O Mercado Pago não autorizou a criação da assinatura.",
      code: "subscription_provider_rejected",
      provider_status: providerResponse.status,
      provider_error_code: providerErrorCode,
    }, providerResponse.status >= 500 ? 502 : 422);
  }

  if (!isRecord(providerBody)) {
    return jsonResponse(request, {
      error: "Resposta inválida do Mercado Pago.",
      code: "subscription_provider_invalid_response",
    }, 502);
  }

  const providerSubscription = providerBody as MercadoPagoSubscription;
  const providerSubscriptionId = cleanString(providerSubscription.id, 128);
  const returnedExternalReference = cleanString(providerSubscription.external_reference, 128);
  const providerAmount = Number(providerSubscription.auto_recurring?.transaction_amount);
  const providerCurrency = cleanString(providerSubscription.auto_recurring?.currency_id, 8).toUpperCase();

  if (
    !providerSubscriptionId
    || (returnedExternalReference && returnedExternalReference !== subscription.external_reference)
    || (Number.isFinite(providerAmount) && providerAmount.toFixed(2) !== Number(subscription.amount).toFixed(2))
    || (providerCurrency && providerCurrency !== "BRL")
  ) {
    console.error("Mercado Pago subscription response did not match local draft", subscription.id);
    return jsonResponse(request, {
      error: "Os dados retornados pelo Mercado Pago não correspondem à assinatura preparada.",
      code: "subscription_provider_data_mismatch",
    }, 502);
  }

  const providerStatus = normalizeSubscriptionStatus(providerSubscription.status);
  const nextPaymentDate = safeIsoDate(providerSubscription.next_payment_date);
  const providerCreatedAt = safeIsoDate(providerSubscription.date_created);
  const providerUpdatedAt = safeIsoDate(providerSubscription.last_modified);
  const nowIso = new Date().toISOString();

  const { data: updatedSubscription, error: updateError } = await supabaseAdmin
    .from("student_subscriptions")
    .update({
      provider_subscription_id: providerSubscriptionId,
      status: providerStatus,
      next_payment_date: nextPaymentDate,
      provider_payer_id: providerSubscription.payer_id == null
        ? null
        : String(providerSubscription.payer_id).slice(0, 128),
      payment_method_id: cleanString(providerSubscription.payment_method_id, 80) || null,
      live_mode: providerSubscription.live_mode === true,
      provider_created_at: providerCreatedAt,
      provider_updated_at: providerUpdatedAt,
      started_at: providerStatus === "authorized" ? nowIso : null,
      last_provider_error_code: null,
      last_provider_error_at: null,
    })
    .eq("id", subscription.id)
    .select(
      "id, provider_subscription_id, external_reference, idempotency_key, status, amount, due_day, first_charge_date, next_payment_date",
    )
    .single();

  if (updateError || !updatedSubscription) {
    console.error("Unable to persist Mercado Pago subscription", updateError?.message);
    return jsonResponse(request, {
      error: "A assinatura foi criada no Mercado Pago, mas a confirmação local falhou. Não tente novamente.",
      code: "subscription_local_confirmation_failed",
      provider_subscription_id: providerSubscriptionId,
    }, 500);
  }

  return jsonResponse(request, {
    ...publicSubscription(updatedSubscription as ExistingSubscription, false),
    init_point: cleanString(providerSubscription.init_point, 1000) || null,
  });
});
