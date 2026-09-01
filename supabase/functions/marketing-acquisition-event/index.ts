import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const ALLOWED_EVENTS = new Set(["page_view", "generate_lead"]);
const ALLOWED_CHANNELS = new Set(["ai_assistant", "organic_search", "paid_search", "social", "referral", "campaign", "direct"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

function safeText(value: unknown, max = 120): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted]")
    .replace(/\b\d{11}\b/g, "[redacted]")
    .slice(0, max);
}

function safeUuid(value: unknown): string | null {
  const text = safeText(value, 50);
  return text && UUID_RE.test(text) ? text.toLowerCase() : null;
}

function safePath(value: unknown): string {
  const raw = safeText(value, 1000) ?? "/";
  try {
    const url = new URL(raw, "https://teacherflavius.com");
    return url.pathname.slice(0, 500) || "/";
  } catch {
    return raw.split(/[?#]/, 1)[0].slice(0, 500) || "/";
  }
}

function safeTimestamp(value: unknown): string {
  const now = Date.now();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) return new Date(now).toISOString();
  if (parsed < now - 7 * 86400000 || parsed > now + 300000) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}

function allowedOrigin(origin: string | null): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    if (url.hostname === "teacherflavius.com" || url.hostname === "www.teacherflavius.com") return origin;
    if (url.hostname === "zoqvera.github.io" || url.hostname.endsWith(".netlify.app")) return origin;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  return null;
}

function headers(origin: string | null): Record<string, string> {
  const result: Record<string, string> = {
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    result["Access-Control-Allow-Headers"] = "content-type";
  }
  return result;
}

function noContent(origin: string | null): Response {
  return new Response(null, { status: 204, headers: headers(origin) });
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("origin");
  const origin = allowedOrigin(requestOrigin);
  if (req.method === "OPTIONS") return noContent(origin);
  if (req.method !== "POST") return new Response(null, { status: 405, headers: headers(origin) });
  if (requestOrigin && !origin) return noContent(null);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16384) return noContent(origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !secretKey) return noContent(origin);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return noContent(origin);
    const input = raw as Record<string, unknown>;

    const eventId = safeUuid(input.event_id);
    const visitorId = safeUuid(input.visitor_id);
    const sessionId = safeUuid(input.session_id);
    const eventName = safeText(input.event_name, 40);
    if (!eventId || !visitorId || !sessionId || !eventName || !ALLOWED_EVENTS.has(eventName)) return noContent(origin);

    const { data: allowed } = await admin.rpc("consume_api_rate_limit", {
      target_bucket_key: `marketing-acquisition:${visitorId}`,
      target_window_seconds: 3600,
      target_max_requests: 120,
    });
    if (!allowed) return noContent(origin);

    const source = (safeText(input.source, 80) ?? "direct").toLowerCase();
    const medium = (safeText(input.medium, 80) ?? "none").toLowerCase();
    const campaign = safeText(input.campaign, 100) ?? "not_set";
    const channelCandidate = (safeText(input.traffic_channel, 50) ?? "direct").toLowerCase();
    const trafficChannel = ALLOWED_CHANNELS.has(channelCandidate) ? channelCandidate : "referral";
    const aiAssistant = safeText(input.ai_assistant, 50)?.toLowerCase() ?? null;
    const linkPosition = eventName === "generate_lead" ? safeText(input.link_position, 80)?.toLowerCase() ?? "unknown" : null;

    const { error } = await admin.from("marketing_acquisition_events").insert({
      event_id: eventId,
      event_name: eventName,
      visitor_id: visitorId,
      session_id: sessionId,
      source,
      medium,
      campaign,
      traffic_channel: trafficChannel,
      ai_assistant: aiAssistant && aiAssistant !== "not_set" ? aiAssistant : null,
      page_path: safePath(input.page_path),
      landing_page: safePath(input.landing_page),
      link_position: linkPosition,
      occurred_at: safeTimestamp(input.occurred_at),
    });

    if (error && error.code !== "23505") console.error("marketing acquisition insert failed", error.code ?? "unknown");
  } catch (error) {
    console.error("marketing acquisition ingestion failed", error instanceof Error ? error.message : "unknown");
  }

  return noContent(origin);
});
