import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const VALID_SLOTS = new Set(["monday_18", "tuesday_10", "tuesday_15", "thursday_20"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2048;

function allowedOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    const origin = new URL(value);
    if (origin.origin !== value) return null;
    if (origin.protocol === "https:" &&
      ["teacherflavius.com", "www.teacherflavius.com", "zoqvera.github.io"].includes(origin.hostname)) {
      return value;
    }
    if (origin.protocol === "http:" && ["localhost", "127.0.0.1"].includes(origin.hostname)) {
      return value;
    }
  } catch { /* Invalid origin. */ }
  return null;
}

function responseHeaders(origin: string | null): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "content-type";
  }
  return headers;
}

function jsonResponse(status: number, data: Record<string, unknown>, origin: string | null): Response {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders(origin) });
}

function secretKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as { default?: string };
      if (parsed.default) return parsed.default;
    } catch { /* Use the legacy key below. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function normalizePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return "55" + digits;
  return digits;
}

function normalizeName(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

async function hashBucket(secret: string, value: string): Promise<string> {
  const content = new TextEncoder().encode(secret + ":" + value);
  const digest = await crypto.subtle.digest("SHA-256", content);
  return Array.from(new Uint8Array(digest)).slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request: Request) => {
  const origin = allowedOrigin(request.headers.get("origin"));
  if (request.method === "OPTIONS") {
    return new Response(null, { status: origin ? 204 : 403, headers: responseHeaders(origin) });
  }
  if (!origin) return jsonResponse(403, { error: "Origem não autorizada." }, null);
  if (request.method !== "POST") return jsonResponse(405, { error: "Método inválido." }, origin);
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return jsonResponse(415, { error: "Formato inválido." }, origin);
  }
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (declaredLength > MAX_BODY_BYTES) {
    return jsonResponse(413, { error: "Dados muito extensos." }, origin);
  }

  let input: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return jsonResponse(413, { error: "Dados muito extensos." }, origin);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse(400, { error: "Preencha os campos obrigatórios." }, origin);
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse(400, { error: "Dados inválidos." }, origin);
  }

  if (input.website) return jsonResponse(400, { error: "Requisição inválida." }, origin);
  const name = normalizeName(input.name);
  const phone = normalizePhone(input.whatsapp);
  const slot = input.lesson_slot;
  const requestId = input.request_id;
  if (name.length < 2 || name.length > 120 ||
    phone.length < 10 || phone.length > 15 ||
    !VALID_SLOTS.has(String(slot)) ||
    typeof requestId !== "string" || !UUID_RE.test(requestId)) {
    return jsonResponse(400, { error: "Confira nome, WhatsApp e aula selecionada." }, origin);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const key = secretKey();
  if (!url || !key) return jsonResponse(503, { error: "Serviço indisponível." }, origin);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    const phoneBucket = await hashBucket(key, "phone:" + phone);
    const ip = (request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0] || "").trim();
    const buckets = [
      { key: "trial-meet:phone:" + phoneBucket, max: 12 },
    ];
    if (ip) buckets.push({
      key: "trial-meet:ip:" + await hashBucket(key, "ip:" + ip),
      max: 60,
    });

    for (const bucket of buckets) {
      const { data, error } = await admin.rpc("consume_api_rate_limit", {
        target_bucket_key: bucket.key,
        target_window_seconds: 3600,
        target_max_requests: bucket.max,
      });
      if (error) throw error;
      if (data !== true) {
        return jsonResponse(429, { error: "Muitas tentativas. Tente novamente mais tarde." }, origin);
      }
    }

    const { data, error } = await admin.rpc("record_trial_meet_access", {
      target_request_id: requestId,
      target_name: name,
      target_whatsapp_digits: phone,
      target_lesson_slot: slot,
    });
    if (error || data !== true) {
      console.error("trial-meet-access failed", error?.code ?? "unknown");
      return jsonResponse(503, { error: "Não foi possível registrar seu acesso. Tente novamente." }, origin);
    }
    return jsonResponse(200, { ok: true }, origin);
  } catch (error) {
    console.error("trial-meet-access unavailable", error instanceof Error ? error.name : "unknown");
    return jsonResponse(503, { error: "Não foi possível registrar seu acesso. Tente novamente." }, origin);
  }
});
