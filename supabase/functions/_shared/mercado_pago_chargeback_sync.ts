import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  cleanString,
  JsonRecord,
  PaymentSyncError,
  synchronizeMercadoPagoPayment,
} from "./mercado_pago_payment_sync.ts";

export type MercadoPagoChargeback = {
  id?: string | number;
  payments?: unknown;
  currency?: string;
  amount?: string | number;
  reason?: string;
  reason_id?: string | number;
  coverage_applied?: boolean | string | null;
  coverage_eligible?: boolean | string | null;
  coverage_elegible?: boolean | string | null;
  documentation_required?: boolean | string | null;
  documentation_status?: string;
  date_documentation_deadline?: string;
  date_created?: string;
  date_last_updated?: string;
  live_mode?: boolean | string | null;
};

export class ChargebackSyncError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ChargebackSyncError";
    this.code = code;
  }
}

const PROVIDER_TIMEOUT_MS = 8_000;
let cachedSellerId = "";

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanIdentifier(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return "";
  return String(value).trim().slice(0, maxLength);
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return null;
}

function safeDate(value: unknown): string | null {
  const text = cleanString(value, 80);
  if (!text) return null;
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function extractPaymentIds(value: unknown): string[] {
  const values = Array.isArray(value) ? value : [value];
  const ids = values.map(function (item) {
    if (typeof item === "string" || typeof item === "number" || typeof item === "bigint") {
      return cleanIdentifier(item, 128);
    }
    if (isRecord(item)) {
      return cleanIdentifier(item.id ?? item.payment_id, 128);
    }
    return "";
  }).filter(Boolean);
  return [...new Set(ids)];
}

async function providerJson(url: string, accessToken: string, sellerId?: string): Promise<JsonRecord> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        ...(sellerId ? { "X-Caller-Id": sellerId } : {}),
      },
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "network_error";
    throw new ChargebackSyncError(
      `chargeback_gateway_${errorName}`.slice(0, 120),
      "Mercado Pago indisponível para consultar a contestação.",
    );
  }

  if (!response.ok) {
    throw new ChargebackSyncError(
      `chargeback_gateway_http_${response.status}`,
      "Mercado Pago não retornou a contestação solicitada.",
    );
  }

  const parsed = await response.json();
  if (!isRecord(parsed)) {
    throw new ChargebackSyncError("chargeback_invalid_response", "Resposta inválida do Mercado Pago.");
  }
  return parsed;
}

async function resolveSellerId(accessToken: string): Promise<string> {
  if (cachedSellerId) return cachedSellerId;
  const configured = cleanIdentifier(Deno.env.get("MERCADO_PAGO_SELLER_ID"), 40);
  if (configured) {
    cachedSellerId = configured;
    return configured;
  }

  const user = await providerJson("https://api.mercadopago.com/users/me", accessToken);
  const sellerId = cleanIdentifier(user.id, 40);
  if (!sellerId) {
    throw new ChargebackSyncError("chargeback_seller_id_missing", "Seller ID do Mercado Pago não disponível.");
  }
  cachedSellerId = sellerId;
  return sellerId;
}

function choosePaymentId(chargeback: MercadoPagoChargeback, expectedPaymentId: string): string {
  const paymentIds = extractPaymentIds(chargeback.payments);
  if (expectedPaymentId) {
    if (!paymentIds.includes(expectedPaymentId)) {
      throw new ChargebackSyncError(
        "chargeback_payment_mismatch",
        "A contestação não pertence ao pagamento informado pelo webhook.",
      );
    }
    return expectedPaymentId;
  }
  if (paymentIds.length !== 1) {
    throw new ChargebackSyncError(
      "chargeback_payment_ambiguous",
      "A contestação possui quantidade inesperada de pagamentos associados.",
    );
  }
  return paymentIds[0];
}

export async function synchronizeMercadoPagoChargeback(options: {
  supabaseAdmin: SupabaseClient;
  accessToken: string;
  chargebackId: string;
  expectedPaymentId?: string;
  sourceWebhookEventId?: string | null;
}): Promise<JsonRecord> {
  const chargebackId = cleanIdentifier(options.chargebackId, 128);
  if (!/^\d+$/.test(chargebackId)) {
    throw new ChargebackSyncError("chargeback_id_invalid", "Identificador de contestação inválido.");
  }

  const sellerId = await resolveSellerId(options.accessToken);
  const chargeback = await providerJson(
    `https://api.mercadopago.com/v1/chargebacks/${encodeURIComponent(chargebackId)}`,
    options.accessToken,
    sellerId,
  ) as MercadoPagoChargeback;
  const returnedChargebackId = cleanIdentifier(chargeback.id, 128);
  if (returnedChargebackId !== chargebackId) {
    throw new ChargebackSyncError("chargeback_identifier_mismatch", "Contestação retornada é incompatível.");
  }

  const expectedPaymentId = cleanIdentifier(options.expectedPaymentId, 128);
  const providerPaymentId = choosePaymentId(chargeback, expectedPaymentId);
  let paymentResult: JsonRecord;
  try {
    paymentResult = await synchronizeMercadoPagoPayment({
      supabaseAdmin: options.supabaseAdmin,
      accessToken: options.accessToken,
      paymentId: providerPaymentId,
    });
  } catch (error) {
    if (error instanceof PaymentSyncError) throw error;
    throw new ChargebackSyncError("chargeback_payment_sync_failed", "Falha ao sincronizar pagamento contestado.");
  }

  const rawAmount = Number(chargeback.amount);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : null;
  const { data: stored, error: storeError } = await options.supabaseAdmin.rpc(
    "upsert_mercado_pago_chargeback",
    {
      target_provider_chargeback_id: chargebackId,
      target_provider_payment_id: providerPaymentId,
      target_source_webhook_event_id: options.sourceWebhookEventId ?? null,
      target_amount: amount,
      target_currency: cleanString(chargeback.currency, 12) || null,
      target_reason: cleanString(chargeback.reason, 240) || null,
      target_reason_id: cleanIdentifier(chargeback.reason_id, 80) || null,
      target_coverage_applied: nullableBoolean(chargeback.coverage_applied),
      target_coverage_eligible: nullableBoolean(chargeback.coverage_eligible ?? chargeback.coverage_elegible),
      target_documentation_required: nullableBoolean(chargeback.documentation_required),
      target_documentation_status: cleanString(chargeback.documentation_status, 80) || null,
      target_documentation_deadline: safeDate(chargeback.date_documentation_deadline),
      target_provider_created_at: safeDate(chargeback.date_created),
      target_provider_updated_at: safeDate(chargeback.date_last_updated),
      target_live_mode: nullableBoolean(chargeback.live_mode),
      target_payment_status: cleanString(paymentResult.provider_status, 40) || null,
    },
  );

  if (storeError || !isRecord(stored)) {
    throw new ChargebackSyncError("chargeback_store_failed", "Falha ao persistir contestação.");
  }

  return {
    ...stored,
    provider_chargeback_id: chargebackId,
    provider_payment_id: providerPaymentId,
    payment_status: paymentResult.provider_status ?? null,
    payment_reversed: paymentResult.payment_reversed === true,
    payment_applied: paymentResult.payment_applied === true,
  };
}
