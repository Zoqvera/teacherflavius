import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

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

function allowedOrigin(request: Request): string {
  const configured = (Deno.env.get("SITE_URL") ?? "https://teacherflavius.com").replace(/\/$/, "");
  const origin = request.headers.get("Origin") ?? "";
  return origin === configured || origin === "https://www.teacherflavius.com" ? origin : configured;
}

function headers(request: Request): HeadersInit {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(request),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(request: Request, body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: headers(request) });
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 8_192) {
    return json(request, { error: "Requisição muito grande." }, 413);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = getDefaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Server environment is incomplete for payment creation control");
    return json(request, { error: "Configuração do servidor incompleta." }, 500);
  }
  if (!authorization.startsWith("Bearer ")) {
    return json(request, { error: "É necessário entrar na conta." }, 401);
  }

  const token = authorization.slice("Bearer ".length).trim();
  const supabaseAuth = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabaseAuth.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) return json(request, { error: "Sessão inválida ou expirada." }, 401);

  const { data: isAdminData, error: adminError } = await supabaseAuth.rpc("is_teacher_admin_mfa");
  if (adminError) {
    console.error("Unable to verify teacher MFA for payment creation control", adminError.message);
    return json(request, { error: "Não foi possível verificar a autorização." }, 500);
  }
  if (isAdminData !== true) {
    return json(request, { error: "MFA do professor é obrigatório." }, 403);
  }

  let body: JsonRecord = {};
  try {
    const raw = await request.text();
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!isRecord(parsed)) throw new Error("Invalid body");
      body = parsed;
    }
  } catch {
    return json(request, { error: "Corpo JSON inválido." }, 400);
  }

  const action = cleanString(body.action, 20) || "get";
  if (action === "get") {
    const { data, error } = await supabaseAdmin.rpc("get_payment_creation_control_internal");
    if (error) {
      console.error("Unable to load payment creation control", error.message);
      return json(request, { error: "Não foi possível carregar o controle de cobranças." }, 500);
    }
    return json(request, { ok: true, control: isRecord(data) ? data : {} });
  }

  if (action !== "set" || typeof body.enabled !== "boolean") {
    return json(request, { error: "Ação ou estado inválido." }, 422);
  }

  const reason = cleanString(body.reason, 500);
  if (body.enabled === false && reason.length < 5) {
    return json(request, { error: "Informe um motivo com pelo menos 5 caracteres." }, 422);
  }

  const { data, error } = await supabaseAdmin.rpc("set_payment_creation_enabled_internal", {
    target_enabled: body.enabled,
    target_reason: reason || null,
    target_actor_user_id: user.id,
  });
  if (error) {
    console.error("Unable to update payment creation control", error.message);
    return json(request, { error: "Não foi possível alterar o controle de cobranças." }, 500);
  }

  return json(request, { ok: true, control: isRecord(data) ? data : {} });
});
