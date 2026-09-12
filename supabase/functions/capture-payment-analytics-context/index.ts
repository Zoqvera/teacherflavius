import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://teacherflavius.com",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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

function json(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanIdentifier(value: unknown): string {
  const text = typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
  return /^[A-Za-z0-9._-]{1,80}$/.test(text) ? text : "";
}

function cleanUuid(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text)
    ? text
    : "";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") ?? "";
  const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();

  if (!supabaseUrl || !secretKey) {
    console.error("Payment analytics context configuration is incomplete");
    return json({ error: "Configuration unavailable" }, 503);
  }
  if (!accessToken) return json({ error: "Unauthorized" }, 401);

  let body: JsonRecord;
  try {
    const raw = await request.json();
    body = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonRecord : {};
  } catch (_error) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (body.analytics_consent !== true) {
    return json({ ok: true, captured: false, reason: "analytics_consent_missing" });
  }

  const tuitionId = cleanUuid(body.tuition_id);
  const idempotencyKey = cleanUuid(body.idempotency_key);
  const clientId = cleanIdentifier(body.client_id);
  const sessionId = cleanIdentifier(body.session_id) || null;
  if (!tuitionId || !idempotencyKey || !clientId) {
    return json({ error: "Invalid analytics context" }, 400);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(accessToken);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Unauthorized" }, 401);

  const { data: tuition, error: tuitionError } = await supabaseAdmin
    .from("monthly_tuition")
    .select("id, student_id")
    .eq("id", tuitionId)
    .eq("student_id", user.id)
    .maybeSingle();
  if (tuitionError) {
    console.error("Unable to validate analytics tuition ownership", tuitionError.message);
    return json({ error: "Unable to validate payment context" }, 500);
  }
  if (!tuition) return json({ error: "Tuition not found" }, 404);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const { error: preflightError } = await supabaseAdmin
    .from("payment_analytics_preflight")
    .upsert({
      idempotency_key: idempotencyKey,
      tuition_id: tuitionId,
      student_id: user.id,
      client_id: clientId,
      session_id: sessionId,
      consent_observed_at: now.toISOString(),
      expires_at: expiresAt,
      updated_at: now.toISOString(),
    }, { onConflict: "idempotency_key" });
  if (preflightError) {
    console.error("Unable to persist payment analytics preflight", preflightError.message);
    return json({ error: "Unable to persist analytics context" }, 500);
  }

  const { data: attempt, error: attemptError } = await supabaseAdmin
    .from("tuition_payment_attempts")
    .select("id, tuition_id, student_id")
    .eq("idempotency_key", idempotencyKey)
    .eq("tuition_id", tuitionId)
    .eq("student_id", user.id)
    .maybeSingle();
  if (attemptError) {
    console.error("Unable to look up payment attempt for analytics", attemptError.message);
    return json({ ok: true, captured: true, linked_attempt: false });
  }

  let enqueued = 0;
  if (attempt) {
    const { error: contextError } = await supabaseAdmin
      .from("payment_analytics_context")
      .upsert({
        attempt_id: attempt.id,
        client_id: clientId,
        session_id: sessionId,
        consent_observed_at: now.toISOString(),
        updated_at: now.toISOString(),
      }, { onConflict: "attempt_id" });
    if (contextError) {
      console.error("Unable to link payment analytics context", contextError.message);
    } else {
      const { data: backfillCount, error: backfillError } = await supabaseAdmin.rpc(
        "backfill_payment_analytics_outbox",
        { target_attempt_id: attempt.id },
      );
      if (backfillError) {
        console.error("Unable to backfill payment analytics outbox", backfillError.message);
      } else {
        enqueued = Number(backfillCount) || 0;
      }
      await supabaseAdmin
        .from("payment_analytics_preflight")
        .delete()
        .eq("idempotency_key", idempotencyKey);
    }
  }

  await supabaseAdmin
    .from("payment_analytics_preflight")
    .delete()
    .lt("expires_at", now.toISOString());

  return json({
    ok: true,
    captured: true,
    linked_attempt: Boolean(attempt),
    enqueued,
  });
});
