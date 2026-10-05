import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import webpush from "npm:web-push@3.6.7";

const ALLOWED_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);

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

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(origin)
      ? origin
      : "https://teacherflavius.com",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(request: Request, body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function bearerToken(request: Request): string {
  return (request.headers.get("authorization") ?? "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== "POST") {
    return jsonResponse(request, { error: "Method not allowed" }, 405);
  }

  const origin = request.headers.get("origin") ?? "";
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return jsonResponse(request, { error: "Origin not allowed" }, 403);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const token = bearerToken(request);

  if (!supabaseUrl || !secretKey || !token) {
    return jsonResponse(request, { error: "Unauthorized" }, 401);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
  if (userError || !userData.user) {
    return jsonResponse(request, { error: "Unauthorized" }, 401);
  }

  const { data: publicKey, error: publicError } = await supabaseAdmin.rpc(
    "get_web_push_vapid_public_key",
  );
  const { data: privateKey, error: privateError } = await supabaseAdmin.rpc(
    "get_web_push_vapid_private_key",
  );

  if (publicError || privateError) {
    console.error("Unable to read VAPID configuration");
    return jsonResponse(request, { error: "Push configuration is unavailable" }, 500);
  }

  const hasPublicKey = typeof publicKey === "string" && publicKey.length > 0;
  const hasPrivateKey = typeof privateKey === "string" && privateKey.length > 0;

  if (hasPublicKey && hasPrivateKey) {
    return jsonResponse(request, { ok: true, initialized: true });
  }
  if (hasPublicKey !== hasPrivateKey) {
    console.error("Incomplete VAPID configuration");
    return jsonResponse(request, { error: "Push configuration is inconsistent" }, 500);
  }

  const generatedKeys = webpush.generateVAPIDKeys();
  const { error: configureError } = await supabaseAdmin.rpc(
    "configure_web_push_vapid_keys",
    {
      target_public_key: generatedKeys.publicKey,
      target_private_key: generatedKeys.privateKey,
    },
  );

  if (configureError) {
    console.error("Unable to initialize VAPID configuration", configureError.message);
    return jsonResponse(request, { error: "Push configuration could not be initialized" }, 500);
  }

  return jsonResponse(request, { ok: true, initialized: true });
});
