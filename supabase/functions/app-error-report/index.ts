import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const ALLOWED_TYPES = new Set([
  "javascript", "unhandled_promise", "resource", "api", "auth", "payment", "not_found", "client_exception",
]);
const ALLOWED_SEVERITIES = new Set(["warning", "error", "critical"]);
const ALLOWED_METADATA = new Set(["phase", "resource_tag", "online", "provider", "function_name"]);

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

function safeText(value: unknown, max = 1000): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, max) : null;
}

function redactText(value: unknown, max = 2000): string | null {
  const text = safeText(value, max * 2);
  if (!text) return null;
  return text
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{11}\b/g, "[redacted-number]")
    .replace(/(https?:\/\/[^\s?#)]+)[?#][^\s)]*/gi, "$1")
    .slice(0, max);
}

function sanitizeUrl(value: unknown): string | null {
  const raw = safeText(value, 4000);
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://teacherflavius.com");
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return `${url.protocol}//${url.host}${url.pathname}`.slice(0, 1000);
  } catch {
    return raw.split(/[?#]/, 1)[0].slice(0, 1000);
  }
}

function sanitizePath(value: unknown): string | null {
  const raw = safeText(value, 2000);
  if (!raw) return null;
  try {
    const url = new URL(raw, "https://teacherflavius.com");
    return url.pathname.slice(0, 1000);
  } catch {
    return raw.split(/[?#]/, 1)[0].slice(0, 1000);
  }
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!ALLOWED_METADATA.has(key)) continue;
    if (typeof raw === "boolean") result[key] = raw;
    else if (typeof raw === "string") result[key] = redactText(raw, 200);
    else if (typeof raw === "number" && Number.isFinite(raw)) result[key] = raw;
  }
  return result;
}

function normalizeTimestamp(value: unknown): string {
  const now = Date.now();
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(parsed)) return new Date(now).toISOString();
  if (parsed < now - 7 * 86400000 || parsed > now + 300000) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function allowedOrigin(origin: string | null) {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
    if (url.hostname === "teacherflavius.com" || url.hostname === "www.teacherflavius.com") return origin;
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return origin;
  } catch {
    return null;
  }
  return null;
}

function responseHeaders(origin: string | null) {
  const headers: Record<string, string> = { "Cache-Control": "no-store", "Vary": "Origin" };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "content-type";
  }
  return headers;
}

function noContent(origin: string | null) {
  return new Response(null, { status: 204, headers: responseHeaders(origin) });
}

Deno.serve(async (req: Request) => {
  const origin = allowedOrigin(req.headers.get("origin"));
  if (req.method === "OPTIONS") return noContent(origin);
  if (req.method !== "POST") return new Response(null, { status: 405, headers: responseHeaders(origin) });
  if (req.headers.get("origin") && !origin) return noContent(null);

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 49152) return noContent(origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !secretKey) return noContent(origin);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const forwardedFor = req.headers.get("cf-connecting-ip")
      ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      ?? "unknown";
    const clientHash = await sha256Hex(forwardedFor);

    const [{ data: hourlyAllowed }, { data: dailyAllowed }] = await Promise.all([
      admin.rpc("consume_api_rate_limit", {
        target_bucket_key: `app-error-report:hour:${clientHash}`,
        target_window_seconds: 3600,
        target_max_requests: 80,
      }),
      admin.rpc("consume_api_rate_limit", {
        target_bucket_key: `app-error-report:day:${clientHash}`,
        target_window_seconds: 86400,
        target_max_requests: 400,
      }),
    ]);
    if (!hourlyAllowed || !dailyAllowed) return noContent(origin);

    const raw = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return noContent(origin);
    const input = raw as Record<string, unknown>;
    const eventType = safeText(input.event_type, 50) ?? "client_exception";
    if (!ALLOWED_TYPES.has(eventType)) return noContent(origin);
    const severityCandidate = safeText(input.severity, 20) ?? "error";
    const severity = ALLOWED_SEVERITIES.has(severityCandidate) ? severityCandidate : "error";
    const message = redactText(input.message, 2000);
    if (!message) return noContent(origin);

    const source = sanitizeUrl(input.source);
    const path = sanitizePath(input.path);
    const stack = redactText(input.stack, 8000);
    const errorCode = redactText(input.error_code, 250);
    const method = safeText(input.http_method, 12)?.toUpperCase() ?? null;
    const statusCandidate = Number(input.http_status);
    const httpStatus = Number.isInteger(statusCandidate) && statusCandidate >= 100 && statusCandidate <= 599
      ? statusCandidate
      : null;
    const fingerprintSeed = [eventType, message, source ?? "", path ?? "", errorCode ?? "", String(httpStatus ?? "")].join("|");
    const fingerprint = (await sha256Hex(fingerprintSeed)).slice(0, 40);

    const { error } = await admin.from("app_error_events").insert({
      event_type: eventType,
      severity,
      message,
      source,
      path,
      stack,
      error_code: errorCode,
      http_status: httpStatus,
      http_method: method,
      fingerprint,
      metadata: normalizeMetadata(input.metadata),
      occurred_at: normalizeTimestamp(input.occurred_at),
    });

    if (error) console.error("app-error-report insert failed", error.code ?? "unknown");
  } catch (error) {
    console.error("app-error-report ingestion failed", error instanceof Error ? error.message : "unknown");
  }

  return noContent(origin);
});
