import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type AnalyticsOutboxRow = {
  id: string;
  event_name: "purchase" | "refund";
  provider_payment_id: string;
  client_id: string;
  session_id: string | null;
  value: number | string;
  currency: string;
  payment_method: string;
};

const DEFAULT_MEASUREMENT_ID = "G-11V3W5B6TG";
const AUTH_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 8_000;
const BATCH_LIMIT = 20;

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

function cleanString(value: unknown, maxLength = 200): string {
  if (typeof value !== "string" && typeof value !== "number") return "";
  return String(value).trim().slice(0, maxLength);
}

function json(body: JsonRecord, status = 200): Response {
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

function buildEvent(row: AnalyticsOutboxRow): JsonRecord {
  const value = Number(row.value);
  const params: JsonRecord = {
    transaction_id: row.provider_payment_id,
    currency: row.currency || "BRL",
    value: Number.isFinite(value) ? value : 0,
    payment_type: row.payment_method || "unknown",
    engagement_time_msec: 1,
    items: [{
      item_id: "monthly_tuition",
      item_name: "Mensalidade Teacher Flávio",
      price: Number.isFinite(value) ? value : 0,
      quantity: 1,
    }],
  };
  if (row.session_id && /^\d+$/.test(row.session_id)) {
    params.session_id = Number(row.session_id);
  }
  return { name: row.event_name, params };
}

async function sendToGa4(
  row: AnalyticsOutboxRow,
  measurementId: string,
  apiSecret: string,
): Promise<void> {
  const endpoint = new URL("https://www.google-analytics.com/mp/collect");
  endpoint.searchParams.set("measurement_id", measurementId);
  endpoint.searchParams.set("api_secret", apiSecret);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: row.client_id,
      events: [buildEvent(row)],
    }),
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ga4_http_${response.status}`);
  }
}

async function finishRow(
  supabaseAdmin: ReturnType<typeof createClient>,
  rowId: string,
  success: boolean,
  errorMessage: string | null,
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc("finish_payment_analytics_outbox", {
    target_id: rowId,
    target_success: success,
    target_error: errorMessage,
  });
  if (error || data !== true) {
    throw new Error("analytics_outbox_finish_failed");
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const apiSecret = (Deno.env.get("GA4_API_SECRET") ?? "").trim();
  const measurementId = (Deno.env.get("GA4_MEASUREMENT_ID") ?? DEFAULT_MEASUREMENT_ID).trim();
  const timestamp = cleanString(request.headers.get("x-reconciliation-timestamp"), 20);
  const signature = cleanString(request.headers.get("x-reconciliation-signature"), 128).toLowerCase();

  if (!supabaseUrl || !secretKey || !apiSecret || !/^G-[A-Z0-9]+$/.test(measurementId)) {
    console.error("Payment analytics dispatch configuration is incomplete");
    return json({ error: "Payment analytics dispatch is not configured" }, 503);
  }
  if (!hasFreshTimestamp(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signatureValid, error: signatureError } = await supabaseAdmin.rpc(
    "validate_mercado_pago_reconciliation_signature",
    {
      candidate_timestamp: timestamp,
      candidate_signature: signature,
    },
  );
  if (signatureError) {
    console.error("Unable to validate payment analytics dispatcher authorization", signatureError.message);
    return json({ error: "Unable to validate authorization" }, 500);
  }
  if (signatureValid !== true) return json({ error: "Unauthorized" }, 401);

  const { data: claimed, error: claimError } = await supabaseAdmin.rpc(
    "claim_payment_analytics_outbox",
    { target_limit: BATCH_LIMIT },
  );
  if (claimError) {
    console.error("Unable to claim payment analytics outbox", claimError.message);
    return json({ error: "Unable to claim analytics outbox" }, 500);
  }

  const rows = (claimed ?? []) as AnalyticsOutboxRow[];
  const summary = { claimed: rows.length, sent: 0, failed: 0 };
  for (const row of rows) {
    try {
      await sendToGa4(row, measurementId, apiSecret);
      await finishRow(supabaseAdmin, row.id, true, null);
      summary.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "analytics_delivery_failed";
      console.error("Payment analytics delivery failed", row.id, message);
      try {
        await finishRow(supabaseAdmin, row.id, false, message);
      } catch (finishError) {
        console.error(
          "Unable to persist payment analytics delivery failure",
          row.id,
          finishError instanceof Error ? finishError.message : finishError,
        );
      }
      summary.failed += 1;
    }
  }

  return json({ ok: true, ...summary });
});
