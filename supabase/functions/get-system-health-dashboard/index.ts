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

function responseHeaders(request: Request): HeadersInit {
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
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: responseHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const publishableKey = getDefaultKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("Authorization") ?? "";

  if (!supabaseUrl || !publishableKey || !secretKey) {
    console.error("Server environment is incomplete for system health dashboard");
    return json(request, { error: "Configuração do servidor incompleta." }, 500);
  }
  if (!authorization.startsWith("Bearer ")) return json(request, { error: "É necessário entrar na conta." }, 401);

  const token = authorization.slice("Bearer ".length).trim();
  const userClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await userClient.auth.getUser(token);
  if (userError || !userData.user) return json(request, { error: "Sessão inválida ou expirada." }, 401);

  const { data: isAdmin, error: adminCheckError } = await userClient.rpc("is_teacher_admin_mfa");
  if (adminCheckError) {
    console.error("Unable to verify teacher MFA for system health dashboard", adminCheckError.message);
    return json(request, { error: "Não foi possível verificar a autorização." }, 500);
  }
  if (isAdmin !== true) return json(request, { error: "MFA do professor é obrigatório." }, 403);

  const { data, error } = await admin.rpc("get_system_health_dashboard_internal");
  if (error) {
    console.error("Unable to load system health dashboard", error.message);
    return json(request, { error: "Não foi possível carregar a saúde operacional." }, 500);
  }

  return json(request, { ok: true, dashboard: data && typeof data === "object" ? data : {} });
});
