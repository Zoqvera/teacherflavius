import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const SITE_ORIGINS = new Set([
  "https://teacherflavius.com",
  "https://www.teacherflavius.com",
]);
const MAX_REQUEST_BYTES = 8192;
const ACCESS_BAN_DURATION = "876000h";

type EnrollmentPayload = {
  name: string;
  contact_email?: string;
  whatsapp?: string;
  class_number: number;
  first_lesson_date: string;
  monthly_fee: number;
  classes_per_month: number;
  due_day: number;
  first_due_date: string;
};

function secretKey(envName: string, legacyName: string): string {
  const value = Deno.env.get(envName);
  if (value) {
    try {
      const parsed = JSON.parse(value) as { default?: string };
      if (parsed.default) return parsed.default;
    } catch {
      // Legacy, plain-text environment variables are supported below.
    }
  }
  return Deno.env.get(legacyName) ?? "";
}

function responseHeaders(origin: string | null): HeadersInit {
  return {
    ...(origin && SITE_ORIGINS.has(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(origin),
  });
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = new Date(value + "T12:00:00Z");
  return !Number.isNaN(timestamp.getTime()) && timestamp.toISOString().startsWith(value);
}

function parseEnrollment(value: unknown): EnrollmentPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Dados da matrícula inválidos.");
  }
  const payload = value as Record<string, unknown>;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const contactEmail = typeof payload.contact_email === "string"
    ? payload.contact_email.trim() : "";
  const whatsapp = typeof payload.whatsapp === "string"
    ? payload.whatsapp.replace(/\D/g, "") : "";
  if (name.length < 3 || name.length > 160) throw new Error("Informe o nome completo.");
  if (contactEmail && (contactEmail.length > 320 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail))) {
    throw new Error("E-mail de contato inválido.");
  }
  if (whatsapp && (whatsapp.length < 10 || whatsapp.length > 13)) {
    throw new Error("WhatsApp inválido.");
  }
  if (!Number.isInteger(payload.class_number) || Number(payload.class_number) <= 0) {
    throw new Error("Selecione uma turma.");
  }
  if (!validDate(payload.first_lesson_date) || !validDate(payload.first_due_date)) {
    throw new Error("Datas da primeira aula e do primeiro vencimento são obrigatórias.");
  }
  if (typeof payload.monthly_fee !== "number"
      || !Number.isFinite(payload.monthly_fee)
      || payload.monthly_fee <= 0 || payload.monthly_fee > 100000) {
    throw new Error("Mensalidade inválida.");
  }
  if (!Number.isInteger(payload.classes_per_month)
      || Number(payload.classes_per_month) < 1
      || Number(payload.classes_per_month) > 31) {
    throw new Error("Informe a quantidade de aulas mensais.");
  }
  if (!Number.isInteger(payload.due_day) ||
      Number(payload.due_day) < 1 || Number(payload.due_day) > 31) {
    throw new Error("Dia de vencimento inválido.");
  }
  return {
    name,
    contact_email: contactEmail || undefined,
    whatsapp: whatsapp || undefined,
    class_number: Number(payload.class_number),
    first_lesson_date: payload.first_lesson_date,
    monthly_fee: Math.round(Number(payload.monthly_fee) * 100) / 100,
    classes_per_month: Number(payload.classes_per_month),
    due_day: Number(payload.due_day),
    first_due_date: payload.first_due_date,
  };
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get("Origin");
  if (origin && !SITE_ORIGINS.has(origin)) {
    return json({ error: "Origem não autorizada." }, 403, origin);
  }
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "Método não permitido." }, 405, origin);
  }
  if (Number(request.headers.get("content-length") || 0) > MAX_REQUEST_BYTES) {
    return json({ error: "Requisição muito grande." }, 413, origin);
  }
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return json({ error: "Faça login como professor." }, 401, origin);
  }

  const url = Deno.env.get("SUPABASE_URL") || "";
  const publicKey = secretKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
  const adminKey = secretKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !publicKey || !adminKey) {
    console.error("Administrative enrollment configuration is incomplete");
    return json({ error: "Configuração do servidor incompleta." }, 500, origin);
  }
  const authenticated = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const token = authorization.slice("Bearer ".length).trim();
  const { data: session, error: sessionError } = await authenticated.auth.getUser(token);
  if (sessionError || !session.user) {
    return json({ error: "Sessão inválida." }, 401, origin);
  }
  const { data: isTeacher, error: teacherError } = await authenticated.rpc("is_teacher_admin");
  if (teacherError || isTeacher !== true) {
    return json({ error: "Acesso exclusivo do professor." }, 403, origin);
  }

  let enrollment: EnrollmentPayload;
  try {
    const raw = await request.text();
    if (raw.length > MAX_REQUEST_BYTES) throw new Error("Requisição muito grande.");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    enrollment = parseEnrollment(parsed);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Dados inválidos." }, 422, origin);
  }

  // A separate Auth identity is necessary because profiles and class memberships
  // reference auth.users. It is banned and has no student-controlled credentials.
  const temporaryEmail = "student-" + crypto.randomUUID() + "@administrativo.teacherflavius.com";
  const randomPassword = crypto.randomUUID() + crypto.randomUUID() + crypto.randomUUID();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: temporaryEmail,
    password: randomPassword,
    email_confirm: false,
  });
  if (createError || !created.user) {
    console.error("Unable to create administrative student identity", createError?.message);
    return json({ error: "Não foi possível criar a identidade administrativa." }, 500, origin);
  }

  const studentId = created.user.id;
  try {
    const internalEmail = "student-" + studentId + "@administrativo.teacherflavius.com";
    const { error: banError } = await admin.auth.admin.updateUserById(studentId, {
      email: internalEmail,
      ban_duration: ACCESS_BAN_DURATION,
      app_metadata: { administrative_student: true },
    });
    if (banError) throw banError;

    const { data, error } = await admin.rpc("create_teacher_administrative_student_internal", {
      target_user_id: studentId,
      target_actor_id: session.user.id,
      target_name: enrollment.name,
      target_contact_email: enrollment.contact_email || null,
      target_whatsapp: enrollment.whatsapp || null,
      target_class_number: enrollment.class_number,
      target_first_lesson_date: enrollment.first_lesson_date,
      target_monthly_fee: enrollment.monthly_fee,
      target_classes_per_month: enrollment.classes_per_month,
      target_due_day: enrollment.due_day,
      target_first_due_date: enrollment.first_due_date,
    });
    if (error) throw error;
    return json({ ok: true, enrollment: data }, 200, origin);
  } catch (error) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(studentId);
    if (cleanupError) {
      console.error("Could not remove incomplete administrative student identity", cleanupError.message);
    }
    const message = error instanceof Error ? error.message : "Falha ao finalizar matrícula.";
    console.error("Administrative enrollment failed", message);
    return json({ error: message }, 422, origin);
  }
});
