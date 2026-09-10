import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import {
  ChargebackSyncError,
  synchronizeMercadoPagoChargeback,
} from "../_shared/mercado_pago_chargeback_sync.ts";
import {
  cleanString,
  getDefaultKey,
  JsonRecord,
  PaymentSyncError,
} from "../_shared/mercado_pago_payment_sync.ts";

const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const BATCH_LIMIT = 20;
const RECONCILIATION_INTERVAL_MS = 6 * 60 * 60 * 1000;

type ChargebackCandidate = {
  id: string;
  provider_chargeback_id: string;
  provider_payment_id: string;
  last_reconciled_at: string | null;
};

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function hasFreshTimestamp(value: string): boolean {
  if (!/^\d{10,13}$/.test(value)) return false;
  const raw = Number(value);
  if (!Number.isFinite(raw)) return false;
  const timestampMs = value.length <= 10 ? raw * 1000 : raw;
  return Math.abs(Date.now() - timestampMs) <= AUTH_TIMESTAMP_TOLERANCE_MS;
}

function isDue(value: string | null, now: number): boolean {
  if (!value) return true;
  const parsed = new Date(value).getTime();
  return !Number.isFinite(parsed) || now - parsed >= RECONCILIATION_INTERVAL_MS;
}

function syncCode(error: unknown): string {
  if (error instanceof ChargebackSyncError || error instanceof PaymentSyncError) return error.code;
  return "unexpected_chargeback_reconciliation_error";
}

async function recordFailure(
  supabaseAdmin: ReturnType<typeof createClient>,
  candidate: ChargebackCandidate,
  code: string,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("payment_chargebacks")
    .update({ last_reconciled_at: now, last_error: code.slice(0, 1000), updated_at: now })
    .eq("id", candidate.id);
  if (error) console.error("Unable to persist chargeback reconciliation failure", candidate.id, error.message);

  if (code.includes("gateway_")) {
    const { error: eventError } = await supabaseAdmin.rpc("record_payment_operational_event", {
      target_event_type: "gateway_failure",
      target_event_code: `chargeback_reconcile_${code}`.slice(0, 160),
      target_attempt_id: null,
      target_provider_payment_id: candidate.provider_payment_id,
      target_details: { source: "chargeback_reconciliation" },
    });
    if (eventError) console.error("Unable to record chargeback gateway failure", eventError.message);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
  const timestamp = cleanString(request.headers.get("x-reconciliation-timestamp"), 20);
  const signature = cleanString(request.headers.get("x-reconciliation-signature"), 128).toLowerCase();
  if (!supabaseUrl || !secretKey || !accessToken) return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  if (!hasFreshTimestamp(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: validSignature, error: signatureError } = await supabaseAdmin.rpc(
    "validate_mercado_pago_reconciliation_signature",
    { candidate_timestamp: timestamp, candidate_signature: signature },
  );
  if (signatureError || validSignature !== true) return jsonResponse({ error: "Unauthorized" }, 401);

  const { data, error } = await supabaseAdmin
    .from("payment_chargebacks")
    .select("id, provider_chargeback_id, provider_payment_id, last_reconciled_at")
    .eq("operational_status", "open")
    .order("last_reconciled_at", { ascending: true, nullsFirst: true })
    .limit(BATCH_LIMIT);
  if (error) return jsonResponse({ error: "Unable to load chargebacks" }, 500);

  const now = Date.now();
  const candidates = ((data ?? []) as ChargebackCandidate[]).filter((candidate) => isDue(candidate.last_reconciled_at, now));
  const summary = { candidates: candidates.length, synchronized: 0, won: 0, lost: 0, open: 0, failed: 0 };

  for (const candidate of candidates) {
    try {
      const result = await synchronizeMercadoPagoChargeback({
        supabaseAdmin,
        accessToken,
        chargebackId: candidate.provider_chargeback_id,
        expectedPaymentId: candidate.provider_payment_id,
      });
      summary.synchronized += 1;
      const status = String(result.operational_status || "open");
      if (status === "won") summary.won += 1;
      else if (status === "lost") summary.lost += 1;
      else summary.open += 1;
    } catch (syncError) {
      summary.failed += 1;
      const code = syncCode(syncError);
      await recordFailure(supabaseAdmin, candidate, code);
      console.error("Unable to reconcile Mercado Pago chargeback", candidate.id, code);
    }
  }

  return jsonResponse({ ok: true, ...summary });
});
