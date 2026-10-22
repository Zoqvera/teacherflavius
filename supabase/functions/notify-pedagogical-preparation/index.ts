import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const FROM_EMAIL = "Acompanhamento Pedagógico <pedagogico@teacherflavius.com>";
const TO_EMAIL = "contato@teacherflavius.com";
const SUBJECT = "Acompanhamento pedagógico";
const TIME_ZONE = "America/Sao_Paulo";
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const encoder = new TextEncoder();

type PendingStudent = {
  student_id: string;
  lesson_number: number | null;
  previous_lesson_at: string;
  lesson_without_text: boolean;
  no_questions_studied: boolean;
};
type Alert = {
  id: string;
  class_number: number;
  starts_at: string;
  students: PendingStudent[];
  status: "pending" | "failed";
  attempts: number;
  created_at: string;
};
type StudentProfile = {
  id: string;
  name: string | null;
  whatsapp: string | null;
  enrolled: boolean;
  archived: boolean;
};
type DisplayStudent = { pending: PendingStudent; profile: StudentProfile };

function serviceKey(): string {
  const stored = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (stored) {
    try {
      const key = (JSON.parse(stored) as { default?: unknown }).default;
      if (typeof key === "string" && key) return key;
    } catch { /* Older Supabase projects may use the legacy variable. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function reply(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function matchesSecret(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const [a, b] = await Promise.all([received, expected].map(
    (secret) => crypto.subtle.digest("SHA-256", encoder.encode(secret)),
  ));
  const first = new Uint8Array(a);
  const second = new Uint8Array(b);
  if (first.length !== second.length) return false;
  let different = 0;
  for (let index = 0; index < first.length; index += 1) {
    different |= first[index] ^ second[index];
  }
  return different === 0;
}

function escapeHtml(value: unknown): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => replacements[character]);
}

function shortDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", year: "numeric",
  }).format(new Date(value));
}

function shortTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

function studentsStillActive(
  candidates: PendingStudent[],
  profiles: StudentProfile[],
): DisplayStudent[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const active: DisplayStudent[] = [];
  for (const pending of candidates) {
    const profile = byId.get(pending.student_id);
    if (profile && profile.enrolled && !profile.archived) {
      active.push({ pending, profile });
    }
  }
  return active;
}

function buildMessage(
  alert: Alert,
  className: string,
  students: DisplayStudent[],
): { text: string; html: string } {
  const nextDate = shortDate(alert.starts_at);
  const nextTime = shortTime(alert.starts_at);
  const textCards: string[] = [];
  const htmlCards: string[] = [];

  for (const student of students) {
    const name = student.profile.name?.trim() || "Não informado";
    const whatsapp = student.profile.whatsapp?.trim() || "Não informado";
    const previousDate = shortDate(student.pending.previous_lesson_at);
    const issues = [
      student.pending.lesson_without_text
        ? "Lição " + student.pending.lesson_number + " sem texto"
        : "",
      student.pending.no_questions_studied ? "Nenhuma pergunta estudada" : "",
    ].filter(Boolean);

    textCards.push([
      "Nome do aluno: " + name,
      "WhatsApp: " + whatsapp,
      "Turma: " + className,
      "Data e hora da próxima aula: " + nextDate + " às " + nextTime,
      "Última aula registrada: " + previousDate,
      ...issues,
    ].join("\n"));

    htmlCards.push([
      '<section style="margin:20px 0;padding:14px;border:1px solid #d8dfe8;border-radius:8px">',
      '<h2 style="font-size:18px;margin:0 0 8px">' + escapeHtml(name) + "</h2>",
      "<p><strong>WhatsApp:</strong> " + escapeHtml(whatsapp) + "</p>",
      "<p><strong>Turma:</strong> " + escapeHtml(className) + "</p>",
      "<p><strong>Próxima aula:</strong> " + escapeHtml(nextDate) + " às " + escapeHtml(nextTime) + "</p>",
      "<p><strong>Última aula registrada:</strong> " + escapeHtml(previousDate) + "</p>",
      "<ul>" + issues.map((issue) => "<li>" + escapeHtml(issue) + "</li>").join("") + "</ul>",
      "</section>",
    ].join("\n"));
  }

  const context = "Turma: " + className + " — " + nextDate + " às " + nextTime;
  return {
    text: [
      "Alunos com preparação pendente",
      context, "", textCards.join("\n\n---\n\n"), "",
      "Perguntas contabilizadas somente após a última aula registrada.",
    ].join("\n"),
    html: [
      '<div style="max-width:660px;margin:0 auto;font-family:Arial,sans-serif;color:#172033;line-height:1.6">',
      "<h1>Acompanhamento pedagógico</h1>",
      "<p>" + escapeHtml(context) + "</p>",
      htmlCards.join("\n"),
      '<p style="color:#667085;font-size:13px">Alerta administrativo enviado apenas ao professor.</p>',
      "</div>",
    ].join("\n"),
  };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = serviceKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const expectedSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  if (!url || !key || !resendKey || !expectedSecret) {
    return reply({ error: "Server configuration is incomplete" }, 500);
  }
  if (!(await matchesSecret(
    request.headers.get("x-webhook-secret") ?? "", expectedSecret
  ))) {
    return reply({ error: "Unauthorized" }, 401);
  }

  let input: { source?: unknown };
  try { input = await request.json(); }
  catch { return reply({ error: "Invalid JSON" }, 400); }
  if (input.source !== "pg_cron") return reply({ error: "Unexpected source" }, 400);

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const deadline = new Date(Date.now() + SIX_HOURS_MS).toISOString();
  const { data, error } = await supabase
    .from("pedagogical_preparation_alerts")
    .select("id,class_number,starts_at,students,status,attempts,created_at")
    .in("status", ["pending", "failed"])
    .lt("attempts", 5)
    .gte("starts_at", deadline)
    .order("starts_at", { ascending: true })
    .limit(15);

  if (error) {
    console.error("Pedagogical queue lookup failed", error.code);
    return reply({ error: "Unable to read queue" }, 500);
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const alert of (data ?? []) as Alert[]) {
    if (!Array.isArray(alert.students) || !alert.students.length) {
      failed += 1;
      continue;
    }
    // Resend idempotency keys remain valid for 24 hours.
    if (alert.attempts > 0 &&
      Date.now() - new Date(alert.created_at).getTime() > 18 * 60 * 60 * 1000) {
      failed += 1;
      continue;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("pedagogical_preparation_alerts")
      .update({
        status: "processing",
        attempts: alert.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", alert.id)
      .eq("status", alert.status)
      .eq("attempts", alert.attempts)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) {
      if (claimError) failed += 1;
      continue;
    }

    const finish = async (status: "sent" | "skipped" | "failed", reason?: string) => {
      const { error: updateError } = await supabase
        .from("pedagogical_preparation_alerts")
        .update({
          status,
          sent_at: status === "sent" ? new Date().toISOString() : null,
          last_error: reason ?? null,
        })
        .eq("id", alert.id)
        .eq("status", "processing");
      if (updateError) console.error("Pedagogical queue update failed", updateError.code);
    };

    try {
      const studentIds = [...new Set(alert.students.map((student) => student.student_id))];
      const [profiles, classInfo] = await Promise.all([
        supabase.from("profiles")
          .select("id,name,whatsapp,enrolled,archived").in("id", studentIds),
        supabase.from("teacher_classes")
          .select("class_name,is_active").eq("class_number", alert.class_number).single(),
      ]);
      if (profiles.error || classInfo.error || !classInfo.data) {
        throw new Error("lookup_failed");
      }
      if (!classInfo.data.is_active) {
        await finish("skipped", "class_inactive");
        skipped += 1;
        continue;
      }

      const active = studentsStillActive(alert.students, profiles.data as StudentProfile[]);
      if (!active.length) {
        await finish("skipped", "no_active_students");
        skipped += 1;
        continue;
      }
      const message = buildMessage(
        alert, classInfo.data.class_name || "Turma " + alert.class_number, active,
      );

      // Never send a reminder with less than six hours remaining.
      if (new Date(alert.starts_at).getTime() - Date.now() < SIX_HOURS_MS) {
        await finish("skipped", "six_hour_deadline_elapsed");
        skipped += 1;
        continue;
      }

      const provider = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + resendKey,
          "Content-Type": "application/json",
          "Idempotency-Key": "pedagogical-preparation-" + alert.id,
        },
        body: JSON.stringify({
          from: FROM_EMAIL,
          reply_to: TO_EMAIL,
          to: [TO_EMAIL],
          subject: SUBJECT,
          text: message.text,
          html: message.html,
        }),
      });

      if (!provider.ok) {
        await finish("failed", "resend_http_" + provider.status);
        failed += 1;
        continue;
      }
      await finish("sent");
      sent += 1;
    } catch {
      await finish("failed", "internal_delivery_error");
      failed += 1;
    }
  }

  return reply({ ok: failed === 0, sent, skipped, failed }, failed ? 207 : 200);
});
