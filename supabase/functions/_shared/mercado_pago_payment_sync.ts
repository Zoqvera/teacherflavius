import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

export type JsonRecord = Record<string, unknown>;

export type MercadoPagoPayment = {
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

export class PaymentSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PaymentSyncError";
    this.code = code;
  }
}

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

export function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function getDefaultKey(envName: string, legacyName: string): string {
  const raw = Deno.env.get(envName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = parsed?.default;
      if (typeof key === "string" && key) return key;
    } catch (_) {
      // The legacy environment variable below remains the compatibility fallback.
    }
  }
  return Deno.env.get(legacyName) ?? "";
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

async function fetchPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPayment> {
  let response: Response;
  try {
    response = await fetch(
      `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "network_error";
    throw new PaymentSyncError(`gateway_${errorName}`.slice(0, 120), "Mercado Pago indisponível.");
  }

  if (!response.ok) {
    throw new PaymentSyncError(
      `gateway_http_${response.status}`,
      "Mercado Pago não retornou o pagamento solicitado.",
    );
  }

  return await response.json() as MercadoPagoPayment;
}

async function clearReversalMarkerAfterReapproval(
  supabaseAdmin: SupabaseClient,
  attemptId: string,
  providerPaymentId: string,
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("mark_mercado_pago_payment_reinstated", {
    target_attempt_id: attemptId,
    target_provider_payment_id: providerPaymentId,
  });
  if (error) {
    throw new PaymentSyncError(
      "reinstatement_failed",
      "Pagamento reprovado anteriormente foi aprovado novamente, mas a auditoria não pôde ser atualizada.",
    );
  }
}

export async function synchronizeMercadoPagoPayment(options: {
  supabaseAdmin: SupabaseClient;
  accessToken: string;
  paymentId: string;
}): Promise<JsonRecord> {
  const payment = await fetchPayment(options.accessToken, options.paymentId);
  const returnedPaymentId = payment.id != null ? String(payment.id) : "";
  const attemptId = cleanString(payment.external_reference, 36);
  const amount = Number(payment.transaction_amount);
  const normalizedStatus = normalizeStatus(payment.status);

  if (
    !returnedPaymentId ||
    returnedPaymentId !== options.paymentId ||
    !attemptId ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    throw new PaymentSyncError("provider_data_mismatch", "Dados inconsistentes retornados pelo Mercado Pago.");
  }

  const { data: attempt, error: attemptError } = await options.supabaseAdmin
    .from("tuition_payment_attempts")
    .select("id, amount, provider_payment_id")
    .eq("id", attemptId)
    .maybeSingle();

  if (attemptError) {
    throw new PaymentSyncError("attempt_load_failed", "Falha ao carregar a tentativa de pagamento.");
  }

  if (!attempt || Number(attempt.amount).toFixed(2) !== amount.toFixed(2)) {
    throw new PaymentSyncError("attempt_mismatch", "Tentativa de pagamento incompatível.");
  }

  if (attempt.provider_payment_id && attempt.provider_payment_id !== returnedPaymentId) {
    throw new PaymentSyncError("payment_identifier_mismatch", "Tentativa vinculada a outro pagamento.");
  }

  const { data: processResult, error: processError } = await options.supabaseAdmin.rpc(
    "process_mercado_pago_payment",
    {
      target_attempt_id: attemptId,
      target_provider_payment_id: returnedPaymentId,
      target_status: normalizedStatus,
      target_status_detail: cleanString(payment.status_detail, 300) || null,
      target_amount: amount,
      target_payment_method: normalizePaymentMethod(payment),
      target_live_mode: payment.live_mode === true,
      target_provider_created_at: safeDate(payment.date_created),
      target_provider_updated_at: safeDate(payment.date_last_updated),
      target_approved_at: safeDate(payment.date_approved),
    },
  );

  if (processError) {
    throw new PaymentSyncError("process_failed", "Falha ao aplicar o estado do pagamento.");
  }

  if (normalizedStatus === "approved") {
    await clearReversalMarkerAfterReapproval(options.supabaseAdmin, attemptId, returnedPaymentId);
  }

  return {
    ...(processResult && typeof processResult === "object" ? processResult as JsonRecord : {}),
    provider_payment_id: returnedPaymentId,
    provider_status: normalizedStatus,
  };
}
