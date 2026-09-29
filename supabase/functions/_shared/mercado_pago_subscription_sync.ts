import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { cleanString, JsonRecord } from "./mercado_pago_payment_sync.ts";

type SubscriptionStatus = "pending" | "authorized" | "paused" | "cancelled";
type PaymentMethod = "pix" | "bank_transfer" | "card" | "other";

type LocalSubscription = {
  id: string;
  student_id: string;
  provider_subscription_id: string | null;
  external_reference: string;
  status: string;
  amount: number | string;
  currency_id: string;
  due_day: number;
  first_charge_date: string;
  started_at: string | null;
  paused_at: string | null;
  cancelled_at: string | null;
};

type MercadoPagoSubscription = {
  id?: string;
  status?: string;
  external_reference?: string | number;
  payer_id?: string | number;
  payment_method_id?: string;
  next_payment_date?: string;
  date_created?: string;
  last_modified?: string;
  live_mode?: boolean;
  auto_recurring?: {
    transaction_amount?: number | string;
    currency_id?: string;
  };
};

type MercadoPagoAuthorizedPayment = {
  id?: string | number;
  type?: string;
  date_created?: string;
  last_modified?: string;
  preapproval_id?: string;
  external_reference?: string | number;
  currency_id?: string;
  transaction_amount?: number | string;
  debit_date?: string;
  status?: string;
  summarized?: string;
  payment?: {
    id?: string | number;
    status?: string;
    status_detail?: string;
  };
};

type MercadoPagoPayment = {
  id?: string | number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number | string;
  payment_method_id?: string;
  payment_type_id?: string;
  external_reference?: string | number;
  live_mode?: boolean;
  date_created?: string;
  date_last_updated?: string;
  date_approved?: string;
};

type AuthorizedPaymentSearch = {
  results?: MercadoPagoAuthorizedPayment[];
};

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

export class SubscriptionSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SubscriptionSyncError";
    this.code = code;
  }
}

function cleanIdentifier(value: unknown, maxLength = 128): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "";
  return String(value).trim().slice(0, maxLength);
}

function safeDate(value: unknown): string | null {
  const text = cleanIdentifier(value, 80);
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeSubscriptionStatus(value: unknown): SubscriptionStatus {
  const status = cleanString(value, 40).toLowerCase();
  if (status === "canceled" || status === "cancelled") return "cancelled";
  if (status === "authorized" || status === "paused") return status;
  return "pending";
}

function normalizePaymentStatus(value: unknown): string | null {
  const status = cleanString(value, 40).toLowerCase();
  return KNOWN_PAYMENT_STATUSES.has(status) ? status : null;
}

function normalizePaymentMethod(payment: MercadoPagoPayment | null): PaymentMethod | null {
  if (!payment) return null;
  const methodId = cleanString(payment.payment_method_id, 80).toLowerCase();
  const typeId = cleanString(payment.payment_type_id, 80).toLowerCase();

  if (methodId === "pix") return "pix";
  if (typeId === "bank_transfer") return "bank_transfer";
  if (["credit_card", "debit_card", "prepaid_card"].includes(typeId)) return "card";
  return methodId || typeId ? "other" : null;
}

async function fetchMercadoPagoJson<T>(
  accessToken: string,
  url: string,
  notFoundCode: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "network_error";
    throw new SubscriptionSyncError(
      `gateway_${name}`.slice(0, 120),
      "Mercado Pago indisponível.",
    );
  }

  if (!response.ok) {
    const code = response.status === 404 ? notFoundCode : `gateway_http_${response.status}`;
    throw new SubscriptionSyncError(code, "Mercado Pago não retornou o recurso solicitado.");
  }

  return await response.json() as T;
}

async function loadSubscriptionByProviderId(
  supabaseAdmin: SupabaseClient,
  providerSubscriptionId: string,
): Promise<LocalSubscription> {
  const { data, error } = await supabaseAdmin
    .from("student_subscriptions")
    .select(
      "id, student_id, provider_subscription_id, external_reference, status, amount, currency_id, due_day, first_charge_date, started_at, paused_at, cancelled_at",
    )
    .eq("provider", "mercado_pago")
    .eq("provider_subscription_id", providerSubscriptionId)
    .maybeSingle();

  if (error) {
    throw new SubscriptionSyncError("subscription_load_failed", "Falha ao consultar a assinatura local.");
  }
  if (!data) {
    throw new SubscriptionSyncError("subscription_not_found", "Assinatura local não encontrada.");
  }
  return data as LocalSubscription;
}

async function loadSubscriptionByExternalReference(
  supabaseAdmin: SupabaseClient,
  externalReference: string,
): Promise<LocalSubscription | null> {
  const { data, error } = await supabaseAdmin
    .from("student_subscriptions")
    .select(
      "id, student_id, provider_subscription_id, external_reference, status, amount, currency_id, due_day, first_charge_date, started_at, paused_at, cancelled_at",
    )
    .eq("provider", "mercado_pago")
    .eq("external_reference", externalReference)
    .maybeSingle();

  if (error) {
    throw new SubscriptionSyncError("subscription_load_failed", "Falha ao consultar a assinatura local.");
  }
  return data as LocalSubscription | null;
}

function assertSubscriptionCommercialTerms(
  local: LocalSubscription,
  providerAmount: unknown,
  providerCurrency: unknown,
): void {
  const amount = Number(providerAmount);
  const currency = cleanString(providerCurrency, 8).toUpperCase();

  if (!Number.isFinite(amount) || amount <= 0 || Number(local.amount).toFixed(2) !== amount.toFixed(2)) {
    throw new SubscriptionSyncError("subscription_amount_mismatch", "Valor da assinatura incompatível.");
  }
  if (currency !== "BRL" || cleanString(local.currency_id, 8).toUpperCase() !== "BRL") {
    throw new SubscriptionSyncError("subscription_currency_mismatch", "Moeda da assinatura incompatível.");
  }
}

async function fetchPayment(accessToken: string, paymentId: string): Promise<MercadoPagoPayment> {
  return await fetchMercadoPagoJson<MercadoPagoPayment>(
    accessToken,
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    "payment_not_found",
  );
}

async function applyAuthorizedPayment(
  supabaseAdmin: SupabaseClient,
  accessToken: string,
  invoice: MercadoPagoAuthorizedPayment,
  expectedAuthorizedPaymentId?: string,
): Promise<JsonRecord> {
  const authorizedPaymentId = cleanIdentifier(invoice.id);
  const providerSubscriptionId = cleanIdentifier(invoice.preapproval_id);
  const invoiceStatus = cleanString(invoice.status, 60).toLowerCase();
  const amount = Number(invoice.transaction_amount);
  const currency = cleanString(invoice.currency_id, 8).toUpperCase();
  const debitDate = safeDate(invoice.debit_date);

  if (
    !authorizedPaymentId ||
    (expectedAuthorizedPaymentId && authorizedPaymentId !== expectedAuthorizedPaymentId) ||
    !providerSubscriptionId ||
    !invoiceStatus ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !debitDate
  ) {
    throw new SubscriptionSyncError(
      "authorized_payment_data_mismatch",
      "Dados inconsistentes da fatura recorrente.",
    );
  }

  const subscription = await loadSubscriptionByProviderId(supabaseAdmin, providerSubscriptionId);
  assertSubscriptionCommercialTerms(subscription, amount, currency);

  const externalReference = cleanIdentifier(invoice.external_reference);
  if (externalReference && externalReference !== subscription.external_reference) {
    throw new SubscriptionSyncError(
      "authorized_payment_reference_mismatch",
      "Fatura vinculada a outra assinatura.",
    );
  }

  const nestedPaymentId = cleanIdentifier(invoice.payment?.id);
  let payment: MercadoPagoPayment | null = null;
  if (nestedPaymentId) {
    payment = await fetchPayment(accessToken, nestedPaymentId);
    const returnedPaymentId = cleanIdentifier(payment.id);
    const paymentAmount = Number(payment.transaction_amount);
    const paymentReference = cleanIdentifier(payment.external_reference);

    if (
      returnedPaymentId !== nestedPaymentId ||
      !Number.isFinite(paymentAmount) ||
      paymentAmount.toFixed(2) !== amount.toFixed(2) ||
      (paymentReference && paymentReference !== subscription.external_reference)
    ) {
      throw new SubscriptionSyncError(
        "subscription_payment_data_mismatch",
        "Pagamento recorrente incompatível com a assinatura.",
      );
    }
  }

  const paymentStatus = normalizePaymentStatus(payment?.status)
    ?? normalizePaymentStatus(invoice.payment?.status)
    ?? normalizePaymentStatus(invoice.summarized);
  const statusDetail = cleanString(
    payment?.status_detail ?? invoice.payment?.status_detail,
    300,
  ) || null;
  const paymentMethod = normalizePaymentMethod(payment);

  const { data, error } = await supabaseAdmin.rpc("process_mercado_pago_subscription_invoice", {
    target_subscription_id: subscription.id,
    target_provider_authorized_payment_id: authorizedPaymentId,
    target_provider_subscription_id: providerSubscriptionId,
    target_provider_payment_id: nestedPaymentId || null,
    target_invoice_status: invoiceStatus,
    target_payment_status: paymentStatus,
    target_status_detail: statusDetail,
    target_amount: amount,
    target_currency_id: currency,
    target_payment_method: paymentMethod,
    target_live_mode: payment?.live_mode === true,
    target_debit_date: debitDate,
    target_provider_created_at: safeDate(invoice.date_created),
    target_provider_updated_at: safeDate(invoice.last_modified),
    target_approved_at: safeDate(payment?.date_approved),
  });

  if (error) {
    throw new SubscriptionSyncError(
      "subscription_invoice_process_failed",
      "Falha ao conciliar a cobrança recorrente.",
    );
  }

  return {
    ...(data && typeof data === "object" ? data as JsonRecord : {}),
    provider_status: paymentStatus ?? invoiceStatus,
    authorized_payment_id: authorizedPaymentId,
    provider_subscription_id: providerSubscriptionId,
  };
}

export async function synchronizeMercadoPagoSubscription(options: {
  supabaseAdmin: SupabaseClient;
  accessToken: string;
  subscriptionId: string;
}): Promise<JsonRecord> {
  const provider = await fetchMercadoPagoJson<MercadoPagoSubscription>(
    options.accessToken,
    `https://api.mercadopago.com/preapproval/${encodeURIComponent(options.subscriptionId)}`,
    "subscription_not_found_at_provider",
  );

  const returnedId = cleanIdentifier(provider.id);
  const externalReference = cleanIdentifier(provider.external_reference);
  if (!returnedId || returnedId !== options.subscriptionId || !externalReference) {
    throw new SubscriptionSyncError(
      "subscription_provider_data_mismatch",
      "Dados inconsistentes retornados pelo Mercado Pago.",
    );
  }

  const local = await loadSubscriptionByExternalReference(options.supabaseAdmin, externalReference);
  if (!local) {
    throw new SubscriptionSyncError("subscription_not_found", "Assinatura local não encontrada.");
  }
  if (local.provider_subscription_id && local.provider_subscription_id !== returnedId) {
    throw new SubscriptionSyncError(
      "subscription_identifier_mismatch",
      "Assinatura local vinculada a outro identificador.",
    );
  }

  assertSubscriptionCommercialTerms(
    local,
    provider.auto_recurring?.transaction_amount,
    provider.auto_recurring?.currency_id,
  );

  const status = normalizeSubscriptionStatus(provider.status);
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {
    provider_subscription_id: returnedId,
    status,
    next_payment_date: safeDate(provider.next_payment_date),
    provider_payer_id: provider.payer_id == null ? null : cleanIdentifier(provider.payer_id),
    payment_method_id: cleanString(provider.payment_method_id, 80) || null,
    live_mode: provider.live_mode === true,
    provider_created_at: safeDate(provider.date_created),
    provider_updated_at: safeDate(provider.last_modified) ?? nowIso,
    last_provider_error_code: null,
    last_provider_error_at: null,
  };

  if (status === "authorized" && !local.started_at) updates.started_at = nowIso;
  if (status === "paused" && !local.paused_at) updates.paused_at = nowIso;
  if (status === "cancelled" && !local.cancelled_at) updates.cancelled_at = nowIso;

  const { error } = await options.supabaseAdmin
    .from("student_subscriptions")
    .update(updates)
    .eq("id", local.id);

  if (error) {
    throw new SubscriptionSyncError(
      "subscription_persist_failed",
      "Falha ao atualizar a assinatura local.",
    );
  }

  return {
    ok: true,
    subscription_id: local.id,
    provider_subscription_id: returnedId,
    provider_status: status,
    next_payment_date: safeDate(provider.next_payment_date),
  };
}

export async function synchronizeMercadoPagoAuthorizedPayment(options: {
  supabaseAdmin: SupabaseClient;
  accessToken: string;
  authorizedPaymentId: string;
}): Promise<JsonRecord> {
  const invoice = await fetchMercadoPagoJson<MercadoPagoAuthorizedPayment>(
    options.accessToken,
    `https://api.mercadopago.com/authorized_payments/${encodeURIComponent(options.authorizedPaymentId)}`,
    "authorized_payment_not_found",
  );

  return await applyAuthorizedPayment(
    options.supabaseAdmin,
    options.accessToken,
    invoice,
    options.authorizedPaymentId,
  );
}

export async function trySynchronizeMercadoPagoSubscriptionPayment(options: {
  supabaseAdmin: SupabaseClient;
  accessToken: string;
  paymentId: string;
}): Promise<JsonRecord | null> {
  const search = await fetchMercadoPagoJson<AuthorizedPaymentSearch>(
    options.accessToken,
    `https://api.mercadopago.com/authorized_payments/search?payment_id=${encodeURIComponent(options.paymentId)}`,
    "authorized_payment_search_not_found",
  );
  const results = Array.isArray(search.results) ? search.results : [];

  if (results.length === 0) return null;
  if (results.length !== 1) {
    throw new SubscriptionSyncError(
      "authorized_payment_ambiguous",
      "Mais de uma fatura foi encontrada para o pagamento recorrente.",
    );
  }

  const invoicePaymentId = cleanIdentifier(results[0].payment?.id);
  if (invoicePaymentId && invoicePaymentId !== options.paymentId) {
    throw new SubscriptionSyncError(
      "subscription_payment_identifier_mismatch",
      "Fatura vinculada a outro pagamento.",
    );
  }

  return await applyAuthorizedPayment(
    options.supabaseAdmin,
    options.accessToken,
    results[0],
  );
}
