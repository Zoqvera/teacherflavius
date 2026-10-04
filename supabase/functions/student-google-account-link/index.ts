import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const browserOrigin = "https://teacherflavius.com";
const androidAppOrigin = "https://localhost";
const allowedOrigins = new Set([browserOrigin, androidAppOrigin]);

function isAllowedOrigin(origin: string | null) {
  return !origin || allowedOrigins.has(origin);
}

function corsHeaders(origin: string | null) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (!origin) {
    headers["Access-Control-Allow-Origin"] = browserOrigin;
  } else if (allowedOrigins.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

function json(body: unknown, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getKey(envName: string, legacyName: string) {
  const raw = Deno.env.get(envName);
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.default) return parsed.default;
      const first = Object.values(parsed || {})[0];
      if (typeof first === "string") return first;
    } catch (_) {}
  }
  return Deno.env.get(legacyName) || "";
}

function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  if (!isAllowedOrigin(origin)) return json({ error: "Origem não permitida." }, 403, origin);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405, origin);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const secretKey = getKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !secretKey) return json({ error: "Configuração interna indisponível." }, 503, origin);

  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) return json({ error: "Sessão ausente." }, 401, origin);

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json({ error: "Sessão inválida." }, 401, origin);

  const googleIdentity = Array.isArray(user.identities)
    ? user.identities.some((identity) => identity?.provider === "google")
    : false;
  if (!googleIdentity) return json({ error: "O acesso deve ser feito por uma conta Google." }, 403, origin);

  const googleEmail = normalizeEmail(user.email);
  if (!googleEmail) return json({ error: "A conta Google não forneceu um e-mail válido." }, 400, origin);

  let payload: Record<string, unknown> = {};
  try { payload = await req.json(); } catch (_) {}
  const action = String(payload.action || "candidate");

  const getCandidate = async () => {
    const { data, error } = await admin.rpc("get_student_google_link_candidate_internal", {
      target_google_user_id: user.id,
      target_google_email: googleEmail,
    });
    if (error) throw error;
    return (data || { show_prompt: false }) as Record<string, unknown>;
  };

  const retryLegacyAuthCleanup = async () => {
    const { data: link, error: linkError } = await admin
      .from("student_google_account_links")
      .select("legacy_user_id,link_mode,legacy_auth_deleted")
      .eq("google_user_id", user.id)
      .maybeSingle();

    if (linkError) {
      console.error("legacy auth cleanup lookup failed", linkError.message);
      return false;
    }

    const legacyUserId = String(link?.legacy_user_id || "");
    if (!link || link.link_mode !== "alias" || link.legacy_auth_deleted === true || !legacyUserId || legacyUserId === user.id) {
      return link?.legacy_auth_deleted === true;
    }

    const deletion = await admin.auth.admin.deleteUser(legacyUserId);
    const alreadyMissing = !!deletion.error && /not\s+found|does\s+not\s+exist/i.test(deletion.error.message || "");

    if (deletion.error && !alreadyMissing) {
      console.error("legacy auth deletion retry failed", deletion.error.message);
      return false;
    }

    const { error: updateError } = await admin
      .from("student_google_account_links")
      .update({ legacy_auth_deleted: true, updated_at: new Date().toISOString() })
      .eq("google_user_id", user.id)
      .eq("legacy_user_id", legacyUserId);

    if (updateError) {
      console.error("legacy auth cleanup state update failed", updateError.message);
      return false;
    }

    return true;
  };

  try {
    const candidate = await getCandidate();

    if (action === "candidate") {
      if (candidate.reason === "already_confirmed") await retryLegacyAuthCleanup();
      return json({
        show_prompt: candidate.show_prompt === true,
        mode: candidate.mode || null,
        enrollment_email: candidate.show_prompt === true ? candidate.enrollment_email || null : null,
        student_name: candidate.show_prompt === true ? candidate.student_name || null : null,
        reason: candidate.reason || null,
      }, 200, origin);
    }

    if (action !== "link") return json({ error: "Ação inválida." }, 400, origin);

    if (candidate.show_prompt !== true) {
      if (candidate.reason === "already_confirmed") {
        await retryLegacyAuthCleanup();
        return json({ linked: true, already_confirmed: true }, 200, origin);
      }
      return json({ error: "Nenhuma matrícula elegível foi encontrada para esta conta Google." }, 409, origin);
    }

    const legacyUserId = String(candidate.legacy_user_id || "");
    const { data: linkResult, error: linkError } = await admin.rpc("confirm_or_migrate_student_google_link_internal", {
      target_google_user_id: user.id,
      target_legacy_user_id: legacyUserId,
      target_google_email: googleEmail,
    });
    if (linkError) throw linkError;

    await retryLegacyAuthCleanup();

    const { data: profile } = await admin
      .from("profiles")
      .select("name,enrollment_code,enrolled,profile_completed")
      .eq("id", user.id)
      .maybeSingle();

    if (profile) {
      const metadata = Object.assign({}, user.user_metadata || {}, {
        name: profile.name || user.user_metadata?.name || "",
        enrollment_code: profile.enrollment_code || "",
        enrolled: profile.enrolled === true,
        profile_completed: profile.profile_completed === true,
      });
      const updateUser = await admin.auth.admin.updateUserById(user.id, { user_metadata: metadata });
      if (updateUser.error) console.error("google user metadata update failed", updateUser.error.message);
    }

    return json({ linked: true, mode: candidate.mode || linkResult?.mode || null }, 200, origin);
  } catch (error) {
    console.error("student-google-account-link failed", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Não foi possível vincular a conta." }, 500, origin);
  }
});
