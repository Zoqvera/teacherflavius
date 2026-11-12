import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const allowedOrigins = new Set(["https://teacherflavius.com", "https://localhost"]);
const bucket = "lesson-example-audio";
const voice = "hpp4J3VqNfWAUOO0d1Us";
const model = "eleven_multilingual_v2";

function key(name: string, fallback: string): string {
  const value = Deno.env.get(name);
  if (value) {
    try { return JSON.parse(value).default || ""; } catch { /* legacy environment */ }
  }
  return Deno.env.get(fallback) || "";
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("origin");
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin",
  };
  if (origin && allowedOrigins.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...headers, "Content-Type": "application/json" },
  });
  if (origin && !allowedOrigins.has(origin)) return respond({ error: "Origem não permitida." }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  if (request.method !== "POST") return respond({ error: "Método não permitido." }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") || "";
    const publicKey = key("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    const secret = key("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const elevenKey = Deno.env.get("ELEVENLABS_API_KEY") || "";
    if (!url || !publicKey || !secret || !elevenKey) return respond({ error: "Áudio temporariamente indisponível." }, 503);
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return respond({ error: "Sessão inválida." }, 401);
    const userClient = createClient(url, publicKey, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
    const { data: user, error: userError } = await userClient.auth.getUser();
    if (userError || !user.user) return respond({ error: "Sessão inválida." }, 401);
    const body = await request.json().catch(() => ({}));
    const pageId = body.pageId;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (pageId !== undefined && (typeof pageId !== "string" || !uuid.test(pageId))) {
      return respond({ error: "Apresentação inválida." }, 400);
    }
    const query = userClient.from("study_lesson_pages").select("id,example,roadmap_lesson_number");
    // Older app versions requested the first presentation without its ID.
    const { data: page, error: pageError } = await (pageId
      ? query.eq("id", pageId)
      : query.eq("roadmap_lesson_number", 1)).maybeSingle();
    if (pageError || !page || !page.example || page.example.length > 1000) return respond({ error: "Apresentação indisponível." }, 404);
    const textHashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(page.example));
    const textHash = Array.from(new Uint8Array(textHashBytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (body.textHash !== textHash) return respond({ error: "A apresentação mudou. Atualize a página." }, 409);
    const bytes = new TextEncoder().encode(`${voice}:${model}:${page.example}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const folder = page.roadmap_lesson_number === 1 ? "presentation-1" : `presentation-${page.id}`;
    const path = `${folder}/${hash}.mp3`;
    const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: bucketInfo } = await admin.storage.getBucket(bucket);
    if (!bucketInfo) {
      const { error } = await admin.storage.createBucket(bucket, { public: false, fileSizeLimit: 5 * 1024 * 1024, allowedMimeTypes: ["audio/mpeg"] });
      if (error && !/already exists|duplicate/i.test(error.message)) throw error;
    }
    const signed = () => admin.storage.from(bucket).createSignedUrl(path, 3600);
    const existing = await admin.storage.from(bucket).list(folder, { search: `${hash}.mp3`, limit: 100 });
    if (existing.error) throw existing.error;
    const exists = existing.data.some((item) => item.name === `${hash}.mp3`);
    if (!exists) {
      const { data: allowed, error } = await admin.rpc("consume_api_rate_limit", {
        target_bucket_key: `lesson-audio:${hash}`, target_window_seconds: 60, target_max_requests: 1,
      });
      if (error) throw error;
      if (!allowed) return respond({ error: "O áudio está sendo preparado. Tente novamente em instantes." }, 429);
      const daily = await admin.rpc("consume_api_rate_limit", {
        target_bucket_key: "lesson-audio:daily", target_window_seconds: 86400, target_max_requests: 50,
      });
      if (daily.error) throw daily.error;
      if (!daily.data) return respond({ error: "Limite diário de geração atingido." }, 429);
      const audioResponse = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
        method: "POST", headers: { "xi-api-key": elevenKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: page.example, model_id: model }),
      });
      if (!audioResponse.ok) return respond({ error: "Não foi possível preparar o áudio agora." }, 502);
      const audio = await audioResponse.arrayBuffer();
      if (!audio.byteLength || audio.byteLength > 5 * 1024 * 1024) throw new Error("Invalid audio size");
      const upload = await admin.storage.from(bucket).upload(path, audio, { contentType: "audio/mpeg", upsert: false });
      if (upload.error && !/already exists|duplicate/i.test(upload.error.message)) throw upload.error;
    }
    const result = await signed();
    if (!result.data?.signedUrl) throw new Error("Audio URL unavailable");
    return respond({ url: result.data.signedUrl });
  } catch (error) {
    console.error("lesson-example-audio:", error instanceof Error ? error.message : "unexpected error");
    return respond({ error: "Não foi possível carregar o áudio. Tente novamente." }, 500);
  }
});
