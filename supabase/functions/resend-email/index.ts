import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const allowedOrigin = "https://teacherflavius.com";
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getDefaultKey(envName: string, legacyName: string): string {
  const raw = Deno.env.get(envName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const key = parsed?.default;
      if (typeof key === "string" && key) return key;
    } catch (_) {}
  }
  return Deno.env.get(legacyName) || "";
}

function headers(origin: string | null) {
  const result: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (!origin || origin === allowedOrigin) result["Access-Control-Allow-Origin"] = allowedOrigin;
  return result;
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (origin && origin !== allowedOrigin) return json({ error: "Origem não permitida." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: headers(origin) });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  const contentLength = Number(req.headers.get("content-length") || "0");
  if (Number.isFinite(contentLength) && contentLength > 128 * 1024) {
    return json({ error: "Requisição muito grande." }, 413, origin);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY") || "";
  const fromEmail = Deno.env.get("RESEND_FROM_EMAIL") || "you@example.com";
  if (!supabaseUrl || !secretKey || !resendApiKey) {
    return json({ error: "Configuração interna indisponível." }, 503, origin);
  }

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sessão ausente." }, 401, origin);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Sessão inválida." }, 401, origin);

  const { data: teacherRows, error: teacherError } = await admin
    .from("teacher_admins")
    .select("user_id,email");
  if (teacherError) return json({ error: "Não foi possível verificar a autorização." }, 500, origin);

  const normalizedUserEmail = String(user.email || "").trim().toLowerCase();
  const isTeacher = (teacherRows || []).some((row: any) =>
    (row.user_id && String(row.user_id) === user.id) ||
    (normalizedUserEmail && String(row.email || "").trim().toLowerCase() === normalizedUserEmail)
  );
  if (!isTeacher) return json({ error: "Acesso restrito ao professor." }, 403, origin);

  const { data: rateAllowed, error: rateError } = await admin.rpc("consume_api_rate_limit", {
    target_bucket_key: `resend-email:hour:${user.id}`,
    target_window_seconds: 3600,
    target_max_requests: 20,
  });
  if (rateError) return json({ error: "Não foi possível verificar o limite de envio." }, 500, origin);
  if (rateAllowed !== true) return json({ error: "Limite de e-mails atingido. Tente novamente mais tarde." }, 429, origin);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch (_) { return json({ error: "JSON inválido." }, 400, origin); }

  const to = String(body.to || "").trim().toLowerCase();
  const subject = String(body.subject || "").replace(/[\r\n]+/g, " ").trim().slice(0, 180);
  const html = String(body.html || "").trim();
  if (!emailPattern.test(to) || !subject || !html) return json({ error: "Destinatário, assunto ou conteúdo inválido." }, 400, origin);
  if (html.length > 100_000) return json({ error: "Conteúdo de e-mail muito grande." }, 413, origin);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${resendApiKey}`,
    },
    body: JSON.stringify({ from: fromEmail, reply_to: "contato@teacherflavius.com", to, subject, html }),
  });

  const responseText = await res.text();
  if (!res.ok) {
    console.error("Resend request failed", res.status);
    return json({ error: "Não foi possível enviar o e-mail." }, 502, origin);
  }

  let providerId: string | null = null;
  try {
    const parsed = JSON.parse(responseText);
    providerId = typeof parsed?.id === "string" ? parsed.id : null;
  } catch (_) {
    providerId = null;
  }

  return json({ ok: true, id: providerId }, 200, origin);
});
