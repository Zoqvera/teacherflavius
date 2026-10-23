import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { servePublicCatalog } from "./catalog_core.mjs";

const PAGE_SIZE = 500;
const MAX_LESSONS = 10000;
const PUBLIC_FIELDS = "roadmap_lesson_number,title,objective";

function resolveSecretKey(): string {
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey) return serviceRoleKey;

  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!keys) return "";

  try {
    const defaultKey = JSON.parse(keys)?.default;
    if (typeof defaultKey !== "string" || !defaultKey) return "";
    return Deno.env.get(defaultKey) ?? defaultKey;
  } catch {
    return "";
  }
}

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const secretKey = resolveSecretKey();
const client = supabaseUrl && secretKey
  ? createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  : null;

async function loadLinkedLessons() {
  if (!client) throw new Error("Supabase credentials unavailable");

  const lessons = [];

  for (let offset = 0; offset < MAX_LESSONS; offset += PAGE_SIZE) {
    const { data, error } = await client
      .from("study_lesson_pages")
      .select(PUBLIC_FIELDS)
      .not("roadmap_lesson_number", "is", null)
      .order("roadmap_lesson_number", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;

    const page = Array.isArray(data) ? data : [];
    lessons.push(...page);

    if (page.length < PAGE_SIZE) return lessons;
  }

  throw new Error("Public catalog exceeds supported pagination limit");
}

Deno.serve((request: Request) => servePublicCatalog(request, loadLinkedLessons));
