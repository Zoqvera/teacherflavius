import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  CURATED_LESSON_NUMBERS,
  CURATED_QUESTION_NUMBERS,
  servePublicSamples
} from "./samples_core.mjs";

const LESSON_FIELDS =
  "roadmap_lesson_number,title,objective,example,translation,practical_exercise,useful_vocabulary";
const QUESTION_FIELDS = "display_order,question_text,question_translation,answer_examples";

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

async function loadCuratedSamples() {
  if (!client) throw new Error("Supabase is not configured");

  const [lessonResponse, questionResponse] = await Promise.all([
    client.from("study_lesson_pages")
      .select(LESSON_FIELDS)
      .in("roadmap_lesson_number", [...CURATED_LESSON_NUMBERS]),
    client.from("conversation_questions")
      .select(QUESTION_FIELDS)
      .in("display_order", [...CURATED_QUESTION_NUMBERS])
  ]);

  if (lessonResponse.error || questionResponse.error) {
    throw new Error("Failed to retrieve editorially selected samples");
  }

  return {
    lessons: lessonResponse.data,
    questions: questionResponse.data
  };
}

Deno.serve((request: Request) => servePublicSamples(request, loadCuratedSamples));
