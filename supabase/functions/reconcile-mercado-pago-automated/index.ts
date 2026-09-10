import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type PaymentAttempt = {
  id: string;
  provider_payment_id: string | null;
  amount: number | string;
  status: string;
  last_reconciled_at: string | null;
  provider_updated_at: string | null;
  created_at: string;
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

type MercadoPagoSearchResponse = {
  results?: MercadoPagoPayment[];
};

type ReconciliationSummary = {
  checked: number;
  synchronized: number;
  recovered: number;
  not_found: number;
  approved: number;
  pending: number;
  reversed: number;
  duplicates: number;
  failed: number;
};

const ACTIVE_STATUSES = new Set([
  "created",
  "pending",
  "authorized",
  "in_process",
  "in_mediation",
]);
const RECONCILABLE_STATUSES = [...ACTIVE_STATUSES, "approved"];
const KNOWN_PAYMENT_STATUSES = new Set([
  ...RECONCILABLE_STATUSES,
  "rejected",
  "cancelled",
  "refunded",
  "charged_back",
]);
const ACTIVE_RECONCILIATION_INTERVAL_MS = 4 * 60 * 1000;
const APPROVED_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const APPROVED_RECONCILIATION_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8_000;
const BATCH_LIMIT = 100;

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

function normalizeAccessToken(value: string | undefined): string {
  let token = (value ?? "").trim();
  if (/^MERCADO_PAGO_ACCESS_TOKEN\s*=/i.test(token)) {
    token = token.replace(/^MERCADO_PAGO_ACCESS_TOKEN\s*=\s*/i, "").trim();
  }
  if (/^Bearer\s+/i.test(token)) {
    token = token.replace(/^Bearer\s+/i, "").trim();
  }
  const quoted = (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"));
  return quoted ? token.slice(1, -1).trim() : token;
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function isDueForReconciliation(attempt: PaymentAttempt, now: number): boolean {
  const lastReconciledAt = timestamp(attempt.last_reconciled_at);
  if (ACTIVE_STATUSES.has(attempt.status)) {
    return lastReconciledAt === null || now - lastReconciledAt >= ACTIVE_RECONCILIATION_INTERVAL_MS;
  }

  if (attempt.status !== "approved") return false;
  const providerUpdatedAt = timestamp(attempt.provider_updated_at) ?? timestamp(attempt.created_at);
  if (providerUpdatedAt === null || now - providerUpdatedAt > APPROVED_RECONCILIATION_WINDOW_MS) return false;
  return lastReconciledAt === null || now - lastReconciledAt >= APPROVED_RECONCILIATION_INTERVAL_MS;
}

function amountMatches(attempt: PaymentAttempt, payment: MercadoPagoPayment): boolean {
  const amount = Number(payment.transaction_amount);
  return Number.isFinite(amount)
    && amount > 0
    && amount.toFixed(2) === Number(attempt.amount).toFixed(2);
}

function validateProviderPayment(attempt: PaymentAttempt, payment: MercadoPagoPayment): void {
  const providerPaymentId = payment.id != null ? String(payment.id) : "";
  const externalReference = cleanString(payment.external_reference, 36);

  if (
    !providerPaymentId
    || (attempt.provider_payment_id && providerPaymentId !== attempt.provider_payment_id)
    || externalReference !== attempt.id
    || !amountMatches(attempt, payment)
  ) {
    throw new Error("Mercado Pago returned inconsistent payment data");
  }
}

async function fetchProviderJson(url: string, accessToken: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Mercado Pago lookup failed with HTTP ${response.status}`);
  }
  return await response.json();
}

async function fetchMercadoPagoPayment(
  accessToken: string,
  providerPaymentId: string,
): Promise<MercadoPagoPayment> {
  const url = `https://api.mercadopago.com/v1/payments/${encodeURIComponent(providerPaymentId)}`;
  return await fetchProviderJson(url, accessToken) as MercadoPagoPayment;
}

async function findMercadoPagoPayment(
  accessToken: string,
  attempt: PaymentAttempt,
): Promise<MercadoPagoPayment | null> {
  const parameters = new URLSearchParams({
    sort: "date_created",
    criteria: "desc",
    external_reference: attempt.id,
    limit: "10",
  });
  const url = `https://api.mercadopago.com/v1/payments/search?${parameters.toString()}`;
  const search = await fetchProviderJson(url, accessToken) as MercadoPagoSearchResponse;
  const matches = (Array.isArray(search.results) ? search.results : []).filter(function (payment) {
    return cleanString(payment.external_reference, 36) === attempt.id && amountMatches(attempt, payment);
  });

  if (matches.length > 1) {
    throw new Error("Multiple Mercado Pago payments found for the same payment attempt");
  }
  return matches[0] ?? null;
}

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function hasFreshTimestamp(value: string): boolean {
  if (!/^\d{10,13}$/.test(value)) return false;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return false;
  const timestampMs = value.length <= 10 ? raw * 1000 : raw;
  return Math.abs(Date.now() - timestampMs) <= AUTH_TIMESTAMP_TOLERANCE_MS;
}

async function markReconciliationMiss(
  supabaseAdmin: ReturnType<typeof createClient>,
  attemptId: string,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("tuition_payment_attempts")
    .update({
      last_reconciled_at: new Date().toISOString(),
      last_reconciliation_error: null,
    })
    .eq("id", attemptId)
    .is("provider_payment_id", null);
  if (error) throw new Error(error.message);
}

async function beginReconciliationRun(
  supabaseAdmin: ReturnType<typeof createClient>,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("begin_mercado_pago_reconciliation_run");
  if (error || typeof data !== "string") {
    console.error("Unable to begin reconciliation heartbeat", error?.message ?? "invalid run id");
    return null;
  }
  return data;
}

async function finishReconciliationRun(
  supabaseAdmin: ReturnType<typeof createClient>,
  runId: string | null,
  status: "succeeded" | "failed",
  summary: JsonRecord,
  errorCode: string | null = null,
): Promise<void> {
  if (!runId) return;
  const { data, error } = await supabaseAdmin.rpc("finish_mercado_pago_reconciliation_run", {
    target_run_id: runId,
    target_status: status,
    target_summary: summary,
    target_error_code: errorCode,
  });
  if (error || data !== true) {
    console.error("Unable to finish reconciliation heartbeat", error?.message ?? "run was not updated");
  }
}

function createSummary(): ReconciliationSummary {
  return {
    checked: 0,
    synchronized: 0,
    recovered: 0,
    not_found: 0,
    approved: 0,
    pending: 0,
    reversed: 0,
    duplicates: 0,
    failed: 0,
  };
}

function resultSummary(candidateCount: number, summary: ReconciliationSummary): JsonRecord {
  return { candidates: candidateCount, ...summary };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const mercadoPagoAccessToken = normalizeAccessToken(Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN"));
  const reconciliationTimestamp = cleanString(request.headers.get("x-reconciliation-timestamp"), 20);
  const reconciliationSignature = cleanString(request.headers.get("x-reconciliation-signature"), 128).toLowerCase();

  if (!supabaseUrl || !secretKey || !mercadoPagoAccessToken) {
    console.error("Server environment is incomplete for automatic Mercado Pago reconciliation");
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  if (!hasFreshTimestamp(reconciliationTimestamp) || !/^[a-f0-9]{64}$/.test(reconciliationSignature)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: validSignature, error: signatureError } = await supabaseAdmin.rpc(
    "validate_mercado_pago_reconciliation_signature",
    {
      candidate_timestamp: reconciliationTimestamp,
      candidate_signature: reconciliationSignature,
    },
  );
  if (signatureError) {
    console.error("Unable to validate reconciliation signature", signatureError.message);
    return jsonResponse({ error: "Unable to validate authorization" }, 500);
  }
  if (validSignature !== true) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const runId = await beginReconciliationRun(supabaseAdmin);
  const { data: attempts, error: attemptsError } = await supabaseAdmin
    .from("tuition_payment_attempts")
    .select("id, provider_payment_id, amount, status, last_reconciled_at, provider_updated_at, created_at")
    .in("status", RECONCILABLE_STATUSES)
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);

  if (attemptsError) {
    console.error("Unable to load Mercado Pago reconciliation candidates", attemptsError.message);
    await finishReconciliationRun(
      supabaseAdmin,
      runId,
      "failed",
      { stage: "candidate_load" },
      "candidate_load_failed",
    );
    return jsonResponse({ error: "Unable to load reconciliation candidates" }, 500);
  }

  const now = Date.now();
  const candidates = ((attempts ?? []) as PaymentAttempt[])
    .filter((attempt) => isDueForReconciliation(attempt, now));
  const summary = createSummary();

  for (const attempt of candidates) {
    summary.checked += 1;

    try {
      const recoveredProviderId = !attempt.provider_payment_id;
      const payment = attempt.provider_payment_id
        ? await fetchMercadoPagoPayment(mercadoPagoAccessToken, attempt.provider_payment_id)
        : await findMercadoPagoPayment(mercadoPagoAccessToken, attempt);

      if (!payment) {
        await markReconciliationMiss(supabaseAdmin, attempt.id);
        summary.not_found += 1;
        continue;
      }

      validateProviderPayment(attempt, payment);
      const status = normalizeStatus(payment.status);
      const { data: processResult, error: processError } = await supabaseAdmin.rpc(
        "process_mercado_pago_payment",
        {
          target_attempt_id: attempt.id,
          target_provider_payment_id: String(payment.id),
          target_status: status,
          target_status_detail: cleanString(payment.status_detail, 300) || null,
          target_amount: Number(payment.transaction_amount),
          target_payment_method: normalizePaymentMethod(payment),
          target_live_mode: payment.live_mode === true,
          target_provider_created_at: safeDate(payment.date_created),
          target_provider_updated_at: safeDate(payment.date_last_updated),
          target_approved_at: safeDate(payment.date_approved),
        },
      );
      if (processError) throw new Error(processError.message);

      const result = (processResult ?? {}) as JsonRecord;
      summary.synchronized += 1;
      if (recoveredProviderId) summary.recovered += 1;
      if (status === "approved") summary.approved += 1;
      if (ACTIVE_STATUSES.has(status)) summary.pending += 1;
      if (result.payment_reversed === true) summary.reversed += 1;
      if (result.duplicate_payment_detected === true) summary.duplicates += 1;
    } catch (error) {
      summary.failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Unable to reconcile Mercado Pago payment", attempt.id, message);
      const { error: recordError } = await supabaseAdmin.rpc(
        "record_mercado_pago_reconciliation_failure",
        { target_attempt_id: attempt.id, target_error: message },
      );
      if (recordError) {
        console.error("Unable to record reconciliation failure", attempt.id, recordError.message);
      }
    }
  }

  const responseSummary = resultSummary(candidates.length, summary);
  await finishReconciliationRun(supabaseAdmin, runId, "succeeded", responseSummary);
  return jsonResponse({ ok: true, ...responseSummary });
});
