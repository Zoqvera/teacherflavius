import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  getDefaultKey,
  JsonRecord,
} from "../_shared/mercado_pago_payment_sync.ts";

const CANDIDATE_TABLE = "mercado_pago_sandbox_reconciliation_candidates";
const PAYMENT_ENDPOINT = "https://api.mercadopago.com/v1/payments";
const PAYMENT_SEARCH_ENDPOINT = `${PAYMENT_ENDPOINT}/search`;
const SANDBOX_REFERENCE_PREFIX = "sandbox-card-";
const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8_000;
const BATCH_LIMIT = 10;

type SandboxCandidate = {
  id: string;
  external_reference: string;
  expected_amount: number | string;
  provider_payment_id: string | null;
  reconciliation_status: string;
  reconciliation_attempts: number;
  first_reconciled_at: string | null;
};

type MercadoPagoPayment = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  payment_method_id?: string;
  external_reference?: string;
  live_mode?: boolean;
};

type MercadoPagoSearchResponse = {
  results?: MercadoPagoPayment[];
};

class SandboxReconciliationError extends Error {
  readonly code: string;
  readonly terminal: boolean;

  constructor(code: string, terminal = false) {
    super(code);
    this.name = "SandboxReconciliationError";
    this.code = code;
    this.terminal = terminal;
  }
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

function normalizeAccessToken(value: string | undefined): string {
  let token = (value ?? "").trim();
  if (/^MERCADO_PAGO_TEST_ACCESS_TOKEN\s*=/i.test(token)) {
    token = token.replace(/^MERCADO_PAGO_TEST_ACCESS_TOKEN\s*=\s*/i, "").trim();
  }
  if (/^Bearer\s+/i.test(token)) {
    token = token.replace(/^Bearer\s+/i, "").trim();
  }
  const quoted = (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"));
  return quoted ? token.slice(1, -1).trim() : token;
}

function hasFreshTimestamp(value: string): boolean {
  if (!/^\d{10,13}$/.test(value)) return false;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return false;
  const timestampMs = value.length <= 10 ? raw * 1000 : raw;
  return Math.abs(Date.now() - timestampMs) <= AUTH_TIMESTAMP_TOLERANCE_MS;
}

function amountMatches(candidate: SandboxCandidate, payment: MercadoPagoPayment): boolean {
  const providerAmount = Number(payment.transaction_amount);
  const expectedAmount = Number(candidate.expected_amount);
  return Number.isFinite(providerAmount)
    && providerAmount > 0
    && Number.isFinite(expectedAmount)
    && providerAmount.toFixed(2) === expectedAmount.toFixed(2);
}

function validateCandidate(candidate: SandboxCandidate): void {
  if (!candidate.external_reference.startsWith(SANDBOX_REFERENCE_PREFIX)) {
    throw new SandboxReconciliationError("invalid_external_reference", true);
  }
  if (candidate.provider_payment_id) {
    throw new SandboxReconciliationError("provider_payment_id_already_present", true);
  }
}

async function fetchProviderJson(url: string, accessToken: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (_error) {
    throw new SandboxReconciliationError("gateway_unreachable");
  }

  if (!response.ok) {
    throw new SandboxReconciliationError(`gateway_http_${response.status}`);
  }

  return await response.json();
}

async function fetchProviderSearch(
  accessToken: string,
  externalReference: string,
): Promise<MercadoPagoSearchResponse> {
  const parameters = new URLSearchParams({
    sort: "date_created",
    criteria: "desc",
    external_reference: externalReference,
    limit: "10",
  });
  const payload = await fetchProviderJson(
    `${PAYMENT_SEARCH_ENDPOINT}?${parameters.toString()}`,
    accessToken,
  );
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SandboxReconciliationError("gateway_invalid_search_payload");
  }
  return payload as MercadoPagoSearchResponse;
}

async function fetchProviderPayment(
  accessToken: string,
  paymentId: string,
): Promise<MercadoPagoPayment> {
  const payload = await fetchProviderJson(
    `${PAYMENT_ENDPOINT}/${encodeURIComponent(paymentId)}`,
    accessToken,
  );
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new SandboxReconciliationError("gateway_invalid_payment_payload");
  }
  return payload as MercadoPagoPayment;
}

function validatePaymentDetails(
  candidate: SandboxCandidate,
  expectedPaymentId: string,
  payment: MercadoPagoPayment,
): void {
  const providerPaymentId = payment.id != null ? String(payment.id) : "";
  if (
    providerPaymentId !== expectedPaymentId
    || cleanString(payment.external_reference, 200) !== candidate.external_reference
    || !amountMatches(candidate, payment)
  ) {
    throw new SandboxReconciliationError("provider_data_mismatch", true);
  }
}

function uniqueSearchPaymentIds(search: MercadoPagoSearchResponse): string[] {
  const results = Array.isArray(search.results) ? search.results : [];
  return [...new Set(
    results
      .map((payment) => payment.id == null ? "" : String(payment.id).trim())
      .filter(Boolean),
  )];
}

function canSkipDetailLookupError(error: unknown): boolean {
  if (!(error instanceof SandboxReconciliationError)) return false;
  return error.code === "gateway_http_403" || error.code === "gateway_http_404";
}

async function discoverSandboxPayment(
  accessToken: string,
  candidate: SandboxCandidate,
): Promise<MercadoPagoPayment | null> {
  const search = await fetchProviderSearch(accessToken, candidate.external_reference);
  const paymentIds = uniqueSearchPaymentIds(search);
  const sandboxMatches = new Map<string, MercadoPagoPayment>();
  let livePaymentSeen = false;

  for (const paymentId of paymentIds) {
    let payment: MercadoPagoPayment;
    try {
      payment = await fetchProviderPayment(accessToken, paymentId);
    } catch (error) {
      if (canSkipDetailLookupError(error)) continue;
      throw error;
    }

    validatePaymentDetails(candidate, paymentId, payment);
    if (payment.live_mode === true) {
      livePaymentSeen = true;
      continue;
    }
    if (payment.live_mode !== false) {
      throw new SandboxReconciliationError("provider_live_mode_missing", true);
    }
    sandboxMatches.set(paymentId, payment);
  }

  if (sandboxMatches.size > 1) {
    throw new SandboxReconciliationError("multiple_matches", true);
  }
  if (sandboxMatches.size === 1) {
    return [...sandboxMatches.values()][0];
  }
  if (livePaymentSeen) {
    throw new SandboxReconciliationError("live_payment_rejected", true);
  }
  return null;
}

function attemptFields(candidate: SandboxCandidate, now: string): JsonRecord {
  return {
    reconciliation_attempts: Math.max(0, Number(candidate.reconciliation_attempts) || 0) + 1,
    first_reconciled_at: candidate.first_reconciled_at || now,
    last_reconciled_at: now,
    updated_at: now,
  };
}

async function markCandidatePending(
  supabaseAdmin: ReturnType<typeof createClient>,
  candidate: SandboxCandidate,
  errorCode: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from(CANDIDATE_TABLE)
    .update({
      ...attemptFields(candidate, now),
      reconciliation_status: "pending",
      last_error_code: errorCode.slice(0, 120),
    })
    .eq("id", candidate.id)
    .eq("reconciliation_status", "pending")
    .is("provider_payment_id", null);
  if (error) throw new Error("sandbox_candidate_pending_update_failed");
}

async function markCandidateFailed(
  supabaseAdmin: ReturnType<typeof createClient>,
  candidate: SandboxCandidate,
  errorCode: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from(CANDIDATE_TABLE)
    .update({
      ...attemptFields(candidate, now),
      reconciliation_status: "failed",
      last_error_code: errorCode.slice(0, 120),
    })
    .eq("id", candidate.id)
    .eq("reconciliation_status", "pending")
    .is("provider_payment_id", null);
  if (error) throw new Error("sandbox_candidate_failed_update_failed");
}

async function markCandidateRecovered(
  supabaseAdmin: ReturnType<typeof createClient>,
  candidate: SandboxCandidate,
  payment: MercadoPagoPayment,
): Promise<void> {
  const providerPaymentId = payment.id != null ? String(payment.id) : "";
  const providerStatus = cleanString(payment.status, 50);
  if (!providerPaymentId || !providerStatus || payment.live_mode !== false) {
    throw new SandboxReconciliationError("provider_data_mismatch", true);
  }

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from(CANDIDATE_TABLE)
    .update({
      ...attemptFields(candidate, now),
      provider_payment_id: providerPaymentId,
      provider_status: providerStatus,
      provider_status_detail: cleanString(payment.status_detail, 160) || null,
      payment_method_id: cleanString(payment.payment_method_id, 50) || null,
      live_mode: false,
      reconciliation_status: "recovered",
      last_error_code: null,
      recovered_at: now,
    })
    .eq("id", candidate.id)
    .eq("reconciliation_status", "pending")
    .is("provider_payment_id", null)
    .select("id")
    .maybeSingle();

  if (error || !data) throw new Error("sandbox_candidate_recovery_update_failed");
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = normalizeAccessToken(Deno.env.get("MERCADO_PAGO_TEST_ACCESS_TOKEN"));
  const reconciliationTimestamp = cleanString(request.headers.get("x-reconciliation-timestamp"), 20);
  const reconciliationSignature = cleanString(request.headers.get("x-reconciliation-signature"), 128).toLowerCase();

  if (!supabaseUrl || !secretKey || !accessToken) {
    console.error("Missing Mercado Pago sandbox reconciliation configuration");
    return jsonResponse({ error: "Sandbox reconciliation configuration is incomplete" }, 503);
  }

  if (!hasFreshTimestamp(reconciliationTimestamp) || !/^[a-f0-9]{64}$/.test(reconciliationSignature)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signatureValid, error: signatureError } = await supabaseAdmin.rpc(
    "validate_mercado_pago_reconciliation_signature",
    {
      candidate_timestamp: reconciliationTimestamp,
      candidate_signature: reconciliationSignature,
    },
  );
  if (signatureError) {
    console.error("Unable to validate sandbox reconciliation authorization", signatureError.message);
    return jsonResponse({ error: "Unable to validate authorization" }, 500);
  }
  if (signatureValid !== true) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data: candidates, error: candidatesError } = await supabaseAdmin
    .from(CANDIDATE_TABLE)
    .select(
      "id, external_reference, expected_amount, provider_payment_id, reconciliation_status, reconciliation_attempts, first_reconciled_at",
    )
    .eq("reconciliation_status", "pending")
    .is("provider_payment_id", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (candidatesError) {
    console.error("Unable to load sandbox reconciliation candidates", candidatesError.message);
    return jsonResponse({ error: "Unable to load sandbox reconciliation candidates" }, 500);
  }

  const summary = {
    candidates: (candidates ?? []).length,
    checked: 0,
    recovered: 0,
    not_found: 0,
    failed: 0,
  };

  for (const candidate of (candidates ?? []) as SandboxCandidate[]) {
    summary.checked += 1;
    try {
      validateCandidate(candidate);
      const payment = await discoverSandboxPayment(accessToken, candidate);
      if (!payment) {
        await markCandidatePending(supabaseAdmin, candidate, "not_found");
        summary.not_found += 1;
        continue;
      }

      await markCandidateRecovered(supabaseAdmin, candidate, payment);
      summary.recovered += 1;
    } catch (error) {
      const code = error instanceof SandboxReconciliationError
        ? error.code
        : error instanceof Error
        ? error.message
        : "sandbox_reconciliation_failed";
      const terminal = error instanceof SandboxReconciliationError && error.terminal;
      console.error("Sandbox Mercado Pago reconciliation failed", candidate.id, code);
      try {
        if (terminal) await markCandidateFailed(supabaseAdmin, candidate, code);
        else await markCandidatePending(supabaseAdmin, candidate, code);
      } catch (recordError) {
        console.error(
          "Unable to persist sandbox reconciliation failure",
          candidate.id,
          recordError instanceof Error ? recordError.message : recordError,
        );
      }
      summary.failed += 1;
    }
  }

  return jsonResponse({ ok: true, sandbox: true, ...summary });
});
