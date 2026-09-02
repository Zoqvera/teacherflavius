import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

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
  "created",
  "pending",
  "approved",
  "authorized",
  "in_process",
  "in_mediation",
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
]);

const ALTERNATIVE_PIX_KEY = "flaviofreitas@ufu.br";

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

function sanitizeProviderCode(value: unknown): string {
  return cleanString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getMercadoPagoErrorCode(payload: unknown): string {
  if (!isRecord(payload)) return "unknown";

  const directCode = sanitizeProviderCode(payload.error) || sanitizeProviderCode(payload.code);
  if (directCode) return directCode;

  if (Array.isArray(payload.cause)) {
    for (const cause of payload.cause) {
      if (!isRecord(cause)) continue;
      const causeCode = sanitizeProviderCode(cause.code);
      if (causeCode) return causeCode;
    }
  }

  return "unknown";
}

function getAccessTokenDiagnostics(accessToken: string): JsonRecord {
  return {
    token_family: accessToken.startsWith("APP_USR-")
      ? "app_usr"
      : accessToken.startsWith("TEST-")
      ? "test"
      : "unrecognized",
    token_length: accessToken.length,
    contains_whitespace: /\s/.test(accessToken),
  };
}

function pixFallbackMessage(professorNotified: boolean): string {
  const notification = professorNotified ? " O professor já foi informado." : "";
  return "O pagamento via PIX está temporariamente indisponível." + notification +
    " Devido a indisponibilidade momentânea do pagamento via PIX por meio do Mercado Pago, você pode enviar o valor do PIX para a chave PIX " + ALTERNATIVE_PIX_KEY + ".";
}

async function notifyProfessorOfMercadoPagoPolicyBlock(input: {
  providerStatus: number;
  providerErrorCode: string;
}): Promise<boolean> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const notificationEmail = Deno.env.get("ENROLLMENT_NOTIFICATION_EMAIL") ?? "";
  const fromEmail = Deno.env.get("ENROLLMENT_FROM_EMAIL") ?? "";

  if (!resendApiKey || !notificationEmail || !fromEmail) {
    console.warn("Mercado Pago policy alert email is not configured");
    return false;
  }

  try {
    const dayKey = new Date().toISOString().slice(0, 10);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `mercado-pago-policy-${input.providerErrorCode}-${dayKey}`,
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notificationEmail],
        subject: "Alerta: pagamento via Mercado Pago indisponível",
        text: [
          "O site detectou que o Mercado Pago recusou a criação de um pagamento por política interna.",
          "",
          `HTTP do Mercado Pago: ${input.providerStatus}`,
          `Código do Mercado Pago: ${input.providerErrorCode}`,
          "",
          "Por privacidade, este alerta não inclui dados do aluno nem identificadores internos da cobrança.",
          "Consulte o Controle de Mensalidades no portal se precisar identificar o caso.",
          `O aluno recebeu a orientação para pagar pela chave PIX alternativa: ${ALTERNATIVE_PIX_KEY}`,
        ].join("\n"),
      }),
    });

    if (!response.ok) {
      console.error("Resend rejected Mercado Pago policy alert", response.status);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Unable to send Mercado Pago policy alert", error instanceof Error ? error.message : error);
    return false;
  }
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

function formatReferenceMonth(value: unknown): string {
  const date = new Date(String(value ?? "") + "T12:00:00Z");
  if (Number.isNaN(date.getTime())) return "mensalidade";
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function safeDate(value: unknown): string | null {
  const text = cleanString(value, 60);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function publicPayment(payment: MercadoPagoPayment, reused = false): JsonRecord {
  return {
    ok: true,
    payment_id: payment.id != null ? String(payment.id) : null,
    status: normalizeStatus(payment.status),
    status_detail: cleanString(payment.status_detail, 160) || null,
    reused,
  };
}

async function fetchMercadoPagoPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPayment> {
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago payment lookup failed with HTTP ${response.status}`);
  }

  return await response.json() as MercadoPagoPayment;
}

async function synchronizePayment(
  supabaseAdmin: ReturnType<typeof createClient>,
  attemptId: string,
  payment: MercadoPagoPayment,
): Promise<void> {
  const providerPaymentId = payment.id != null ? String(payment.id) : "";
  const amount = Number(payment.transaction_amount);
  if (!providerPaymentId || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("Mercado Pago returned an incomplete payment");
  }

  const { error } = await supabaseAdmin.rpc("process_mercado_pago_payment", {
    target_attempt_id: attemptId,
    target_provider_payment_id: providerPaymentId,
    target_status: normalizeStatus(payment.status),
    target_status_detail: cleanString(payment.status_detail, 300) || null,
    target_amount: amount,
    target_payment_method: normalizePaymentMethod(payment),
    target_live_mode: payment.live_mode === true,
    target_provider_created_at: safeDate(payment.date_created),
    target_provider_updated_at: safeDate(payment.date_last_updated),
    target_approved_at: safeDate(payment.date_approved),
  });

  if (error) throw new Error(`Unable to synchronize payment: ${error.message}`);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(request) });
  }

  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Método não permitido." }, 405);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 32_768) {
    return jsonResponse(request, { error: "Requisição muito grande." }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = normalizeAccessToken(Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN"));
  const mercadoPagoPublicKey = (Deno.env.get("MERCADO_PAGO_PUBLIC_KEY") ?? "").trim();
  const authorization = request.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !anonKey || !secretKey) {
    console.error("Supabase environment is incomplete for Mercado Pago payments");
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

  let body: JsonRecord;
  try {
    const parsed = await request.json();
    if (!isRecord(parsed)) throw new Error("Invalid body");
    body = parsed;
  } catch {
    return jsonResponse(request, { error: "Corpo JSON inválido." }, 400);
  }

  const action = cleanString(body.action, 30);
  if (action === "config") {
    if (!mercadoPagoPublicKey || !mercadoPagoAccessToken) {
      return jsonResponse(request, {
        error: "O Mercado Pago ainda não foi configurado pelo professor.",
        code: "mercado_pago_not_configured",
      }, 503);
    }

    return jsonResponse(request, { ok: true, public_key: mercadoPagoPublicKey });
  }

  if (action !== "pay") {
    return jsonResponse(request, { error: "Ação inválida." }, 400);
  }

  if (!mercadoPagoPublicKey || !mercadoPagoAccessToken) {
    return jsonResponse(request, {
      error: "O Mercado Pago ainda não foi configurado pelo professor.",
      code: "mercado_pago_not_configured",
    }, 503);
  }

  const tuitionId = cleanString(body.tuition_id, 36);
  const idempotencyKey = cleanString(body.idempotency_key, 36);
  const selectedPaymentMethod = cleanString(body.selected_payment_method, 40).toLowerCase();
  const paymentData = isRecord(body.payment_data) ? body.payment_data : null;

  if (!isUuid(tuitionId) || !isUuid(idempotencyKey) || !paymentData) {
    return jsonResponse(request, { error: "Dados da cobrança inválidos." }, 422);
  }

  const { data: tuition, error: tuitionError } = await supabaseAdmin
    .from("monthly_tuition")
    .select("id, student_id, reference_month, due_date, amount_due, payment_date")
    .eq("id", tuitionId)
    .eq("student_id", user.id)
    .maybeSingle();

  if (tuitionError) {
    console.error("Unable to load tuition", tuitionId, tuitionError.message);
    return jsonResponse(request, { error: "Não foi possível consultar a mensalidade." }, 500);
  }

  if (!tuition) {
    return jsonResponse(request, { error: "Mensalidade não encontrada para esta conta." }, 404);
  }

  if (tuition.payment_date) {
    return jsonResponse(request, { error: "Esta mensalidade já está paga.", code: "already_paid" }, 409);
  }

  const amount = Number(tuition.amount_due);
  if (!Number.isFinite(amount) || amount <= 0) {
    return jsonResponse(request, { error: "O valor da mensalidade é inválido." }, 422);
  }

  const { data: sameAttempt, error: sameAttemptError } = await supabaseAdmin
    .from("tuition_payment_attempts")
    .select("id, tuition_id, student_id, provider_payment_id, status, created_at")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (sameAttemptError) {
    console.error("Unable to check idempotency key", sameAttemptError.message);
    return jsonResponse(request, { error: "Não foi possível iniciar o pagamento." }, 500);
  }

  if (sameAttempt && (sameAttempt.tuition_id !== tuitionId || sameAttempt.student_id !== user.id)) {
    return jsonResponse(request, { error: "Chave de pagamento inválida." }, 409);
  }

  if (sameAttempt?.provider_payment_id) {
    try {
      const payment = await fetchMercadoPagoPayment(mercadoPagoAccessToken, sameAttempt.provider_payment_id);
      await synchronizePayment(supabaseAdmin, sameAttempt.id, payment);
      return jsonResponse(request, publicPayment(payment, true));
    } catch (error) {
      console.error("Unable to reuse Mercado Pago payment", sameAttempt.id, error instanceof Error ? error.message : error);
      return jsonResponse(request, { error: "Não foi possível recuperar o pagamento já iniciado." }, 502);
    }
  }

  if (!sameAttempt) {
    const { data: activeAttempt, error: activeAttemptError } = await supabaseAdmin
      .from("tuition_payment_attempts")
      .select("id, provider_payment_id, status, created_at")
      .eq("tuition_id", tuitionId)
      .eq("student_id", user.id)
      .in("status", ACTIVE_ATTEMPT_STATUSES)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeAttemptError) {
      console.error("Unable to check active payment attempts", activeAttemptError.message);
      return jsonResponse(request, { error: "Não foi possível verificar pagamentos em andamento." }, 500);
    }

    if (activeAttempt?.provider_payment_id) {
      try {
        const payment = await fetchMercadoPagoPayment(mercadoPagoAccessToken, activeAttempt.provider_payment_id);
        await synchronizePayment(supabaseAdmin, activeAttempt.id, payment);
        const status = normalizeStatus(payment.status);
        if (ACTIVE_ATTEMPT_STATUSES.includes(status) || status === "approved") {
          return jsonResponse(request, publicPayment(payment, true));
        }
      } catch (error) {
        console.error("Unable to validate active Mercado Pago payment", activeAttempt.id, error instanceof Error ? error.message : error);
        return jsonResponse(request, {
          error: "Já existe um pagamento em processamento. Aguarde alguns instantes e tente novamente.",
          code: "payment_in_progress",
        }, 409);
      }
    } else if (activeAttempt) {
      const createdAt = new Date(activeAttempt.created_at).getTime();
      if (Number.isFinite(createdAt) && Date.now() - createdAt < 10 * 60 * 1000) {
        return jsonResponse(request, {
          error: "Já existe uma tentativa de pagamento em processamento.",
          code: "payment_in_progress",
        }, 409);
      }
    }
  }

  let attempt = sameAttempt;
  if (!attempt) {
    const { data: insertedAttempt, error: insertError } = await supabaseAdmin
      .from("tuition_payment_attempts")
      .insert({
        tuition_id: tuitionId,
        student_id: user.id,
        idempotency_key: idempotencyKey,
        amount,
        status: "created",
      })
      .select("id, tuition_id, student_id, provider_payment_id, status, created_at")
      .single();

    if (insertError || !insertedAttempt) {
      console.error("Unable to create tuition payment attempt", insertError?.message);
      return jsonResponse(request, { error: "Não foi possível iniciar o pagamento." }, 500);
    }
    attempt = insertedAttempt;
  }

  const paymentMethodId = cleanString(paymentData.payment_method_id, 64).toLowerCase();
  const tokenizedCard = cleanString(paymentData.token, 256);
  const isPix = paymentMethodId === "pix" || selectedPaymentMethod === "pix" || selectedPaymentMethod === "bank_transfer";
  const isCreditCard = !isPix && (
    selectedPaymentMethod === "credit_card"
    || selectedPaymentMethod === "creditcard"
    || !!tokenizedCard
  );

  if ((!isPix && !isCreditCard) || (isPix && paymentMethodId !== "pix")) {
    await supabaseAdmin.from("tuition_payment_attempts").update({ status: "rejected", status_detail: "unsupported_method" }).eq("id", attempt.id);
    return jsonResponse(request, { error: "Escolha Pix ou cartão de crédito." }, 422);
  }

  if (!isPix && (!tokenizedCard || !/^[a-z0-9_-]{2,64}$/i.test(paymentMethodId))) {
    await supabaseAdmin.from("tuition_payment_attempts").update({ status: "rejected", status_detail: "invalid_card_data" }).eq("id", attempt.id);
    return jsonResponse(request, { error: "Os dados do cartão estão incompletos." }, 422);
  }

  const payer = isRecord(paymentData.payer) ? paymentData.payer : {};
  const identification = isRecord(payer.identification) ? payer.identification : {};
  const identificationType = cleanString(identification.type, 12).toUpperCase();
  const identificationNumber = cleanString(identification.number, 30).replace(/\D/g, "");
  const payerEmail = cleanString(user.email, 254).toLowerCase();
  if (!payerEmail) {
    await supabaseAdmin
      .from("tuition_payment_attempts")
      .update({ status: "rejected", status_detail: "missing_payer_email" })
      .eq("id", attempt.id);
    return jsonResponse(request, {
      error: "A conta do aluno precisa ter um e-mail válido para realizar o pagamento.",
    }, 422);
  }

  const payerPayload: JsonRecord = { email: payerEmail };

  if (identificationType && identificationNumber) {
    payerPayload.identification = {
      type: identificationType,
      number: identificationNumber,
    };
  }

  const mercadoPagoPayload: JsonRecord = {
    transaction_amount: amount,
    description: `Mensalidade Teacher Flávio — ${formatReferenceMonth(tuition.reference_month)}`,
    external_reference: attempt.id,
    payment_method_id: isPix ? "pix" : paymentMethodId,
    payer: payerPayload,
    metadata: {
      tuition_id: tuitionId,
      payment_attempt_id: attempt.id,
    },
  };

  if (isCreditCard) {
    const installments = Number(paymentData.installments);
    const issuerId = Number(paymentData.issuer_id);
    if (installments !== 1) {
      await supabaseAdmin.from("tuition_payment_attempts").update({ status: "rejected", status_detail: "invalid_installments" }).eq("id", attempt.id);
      return jsonResponse(request, { error: "Quantidade de parcelas inválida." }, 422);
    }
    mercadoPagoPayload.token = tokenizedCard;
    mercadoPagoPayload.installments = installments;
    if (Number.isFinite(issuerId) && issuerId > 0) mercadoPagoPayload.issuer_id = issuerId;
  }

  const mercadoPagoResponse = await fetch("https://api.mercadopago.com/v1/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${mercadoPagoAccessToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(mercadoPagoPayload),
  });

  let mercadoPagoPayment: MercadoPagoPayment | null = null;
  try {
    mercadoPagoPayment = await mercadoPagoResponse.json() as MercadoPagoPayment;
  } catch {
    mercadoPagoPayment = null;
  }

  if (!mercadoPagoResponse.ok || !mercadoPagoPayment?.id) {
    const providerErrorCode = getMercadoPagoErrorCode(mercadoPagoPayment);
    const providerStatusDetail = `provider_http_${mercadoPagoResponse.status}_${providerErrorCode}`.slice(0, 300);
    await supabaseAdmin
      .from("tuition_payment_attempts")
      .update({ status: "rejected", status_detail: providerStatusDetail })
      .eq("id", attempt.id);
    console.error("Mercado Pago rejected payment creation", {
      attempt_id: attempt.id,
      provider_status: mercadoPagoResponse.status,
      provider_error_code: providerErrorCode,
      ...getAccessTokenDiagnostics(mercadoPagoAccessToken),
    });

    if (mercadoPagoResponse.status === 403 && providerErrorCode === "pa_unauthorized_result_from_policies") {
      const professorNotified = await notifyProfessorOfMercadoPagoPolicyBlock({
        providerStatus: mercadoPagoResponse.status,
        providerErrorCode,
      });
      return jsonResponse(request, {
        error: pixFallbackMessage(professorNotified),
        code: "mercado_pago_pix_temporarily_unavailable",
        provider_error_code: providerErrorCode,
        alternative_pix_key: ALTERNATIVE_PIX_KEY,
        professor_notified: professorNotified,
      }, 503);
    }

    if (mercadoPagoResponse.status === 401) {
      return jsonResponse(request, {
        error: "O Mercado Pago recusou a credencial privada desta integração. O professor precisa revisar ou reativar as credenciais da aplicação.",
        code: "mercado_pago_unauthorized",
        provider_error_code: providerErrorCode,
      }, 502);
    }

    return jsonResponse(request, {
      error: "O Mercado Pago não conseguiu processar os dados informados. Revise-os e tente novamente.",
      code: "provider_rejected_payment",
      provider_error_code: providerErrorCode,
    }, 422);
  }

  try {
    await synchronizePayment(supabaseAdmin, attempt.id, mercadoPagoPayment);
  } catch (error) {
    console.error("Payment created but local synchronization failed", attempt.id, error instanceof Error ? error.message : error);
    return jsonResponse(request, {
      ...publicPayment(mercadoPagoPayment),
      sync_pending: true,
    }, 202);
  }

  return jsonResponse(request, publicPayment(mercadoPagoPayment));
});