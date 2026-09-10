import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type ProbeTarget = {
  key: string;
  url: string;
  validate?: (response: Response) => Promise<boolean>;
};

const encoder = new TextEncoder();
const REQUEST_TIMEOUT_MS = 8_000;

const TARGETS: ProbeTarget[] = [
  { key: "home", url: "https://teacherflavius.com/" },
  {
    key: "health",
    url: "https://teacherflavius.com/health.json",
    validate: async (response) => {
      const body = await response.clone().json().catch(() => null) as JsonRecord | null;
      return body?.status === "ok" && body?.service === "teacherflavius.com";
    },
  },
  { key: "login", url: "https://teacherflavius.com/login/" },
  { key: "student_access", url: "https://teacherflavius.com/acesso-aluno/" },
];

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
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

async function secretsMatch(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const [left, right] = await Promise.all([digest(received), digest(expected)]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

async function probe(target: ProbeTarget): Promise<JsonRecord> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(target.url, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: { "User-Agent": "TeacherFlavius-System-Health/1.0" },
      signal: controller.signal,
    });
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    let valid = response.status === 200;
    if (valid && target.validate) valid = await target.validate(response);

    return {
      target_key: target.key,
      target_url: target.url,
      ok: valid,
      http_status: response.status,
      latency_ms: latencyMs,
      error_code: valid ? null : response.status === 200 ? "unexpected_response" : `http_${response.status}`,
      checked_at: new Date().toISOString(),
    };
  } catch (error) {
    const latencyMs = Math.max(0, Math.round(performance.now() - started));
    const code = error instanceof DOMException && error.name === "AbortError" ? "timeout" : "network_error";
    return {
      target_key: target.key,
      target_url: target.url,
      ok: false,
      http_status: null,
      latency_ms: latencyMs,
      error_code: code,
      checked_at: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const expectedWebhookSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  const receivedWebhookSecret = request.headers.get("x-webhook-secret") ?? "";

  if (!supabaseUrl || !secretKey || !expectedWebhookSecret) {
    console.error("Server environment is incomplete for system synthetic probe");
    return json({ error: "Server configuration is incomplete" }, 500);
  }
  if (!(await secretsMatch(receivedWebhookSecret, expectedWebhookSecret))) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const results = await Promise.all(TARGETS.map(probe));
  for (const result of results) {
    const { error } = await admin.rpc("record_system_synthetic_probe", {
      target_key: result.target_key,
      target_url: result.target_url,
      target_ok: result.ok,
      target_http_status: result.http_status,
      target_latency_ms: result.latency_ms,
      target_error_code: result.error_code,
      target_checked_at: result.checked_at,
    });
    if (error) {
      console.error("Unable to persist synthetic probe result", result.target_key, error.message);
      return json({ error: "Unable to persist probe results" }, 500);
    }
  }

  const { data: health, error: healthError } = await admin.rpc("run_system_health_check_internal", {
    target_notify: true,
  });
  if (healthError) {
    console.error("Unable to run system health check", healthError.message);
    return json({ error: "Unable to run system health check" }, 500);
  }

  const failedTargets = results.filter((result) => result.ok !== true).map((result) => String(result.target_key));
  return json({
    ok: failedTargets.length === 0,
    failed_targets: failedTargets,
    health,
  }, failedTargets.length === 0 ? 200 : 207);
});
