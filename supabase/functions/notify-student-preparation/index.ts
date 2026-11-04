import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const FROM = "Acompanhamento Pedagógico <pedagogico@teacherflavius.com>";
const SUBJECT = "Sua próxima aula de inglês está chegando!";
const TIME_ZONE = "America/Sao_Paulo";
const STUDY_TARGET = 5;
const MAX_ATTEMPTS = 5;
const encoder = new TextEncoder();

type Reminder = {
  id: string;
  student_id: string;
  class_number: number;
  starts_at: string;
  status: "pending" | "failed";
  attempts: number;
};
type Context = {
  student_id: string;
  student_email: string;
  student_name: string;
  class_name: string;
  lesson_number: number | null;
  studied_questions: number;
  missing_presentation: boolean;
  missing_questions: boolean;
};

function serviceKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const key = (JSON.parse(keys) as { default?: unknown }).default;
      if (typeof key === "string" && key) return key;
    } catch { /* Legacy projects may use a standalone key. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
}

function response(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function authorized(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const digests = await Promise.all(
    [received, expected].map((value) =>
      crypto.subtle.digest("SHA-256", encoder.encode(value))
    ),
  );
  const a = new Uint8Array(digests[0]);
  const b = new Uint8Array(digests[1]);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) difference |= a[i] ^ b[i];
  return difference === 0;
}

function escapeHtml(value: unknown): string {
  const replacements: Record<string, string> = {
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  };
  return String(value ?? "").replace(/[&<>"']/g, (character) => replacements[character]);
}

function localDate(value: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return fields.year + "-" + fields.month + "-" + fields.day;
}

function tomorrow(today: string): string {
  const next = new Date(today + "T00:00:00Z");
  next.setUTCDate(next.getUTCDate() + 1);
  return next.toISOString().slice(0, 10);
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

function buildMessage(context: Context, startsAt: string): {
  text: string;
  html: string;
} {
  const date = shortDate(startsAt);
  const time = shortTime(startsAt);
  const firstName = context.student_name.trim().split(/\s+/)[0] || "aluno";
  const tasks: string[] = [];
  if (context.missing_presentation && context.lesson_number !== null) {
    tasks.push(
      "Apresentação " + context.lesson_number +
      ": escreva sua apresentação na caixa de texto da plataforma.",
    );
  }
  if (context.missing_questions) {
    const completed = Math.max(0, Math.min(STUDY_TARGET, context.studied_questions));
    tasks.push(
      "Perguntas de conversação: estude pelo menos 5 perguntas. Você já marcou " +
      completed + " como estudadas; faltam " + (STUDY_TARGET - completed) + ".",
    );
  }

  const intro = [
    "Olá, " + firstName + "!",
    "",
    "Sua próxima aula está chegando!",
    "Data: " + date + " às " + time + " — " + context.class_name,
    "",
    "Antes da aula, prepare as seguintes atividades:",
    ...tasks.map((task) => "- " + task),
    "",
    "Acesse sua área de estudos: https://teacherflavius.com/",
    "",
    "Até a próxima aula!",
    "Teacher Flávio",
  ];
  const html = [
    '<div style="max-width:620px;margin:0 auto;font-family:Arial,sans-serif;line-height:1.6;color:#19253a">',
    "<p>Olá, " + escapeHtml(firstName) + "!</p>",
    '<h1 style="font-size:24px">Sua próxima aula está chegando!</h1>',
    "<p><strong>Próxima aula:</strong> " + escapeHtml(date) + " às " +
      escapeHtml(time) + " — " + escapeHtml(context.class_name) + "</p>",
    "<p>Antes da aula, prepare as seguintes atividades:</p>",
    "<ul>" + tasks.map((task) => "<li>" + escapeHtml(task) + "</li>").join("") + "</ul>",
    '<p><a href="https://teacherflavius.com/" style="color:#164b9e">Acesse sua área de estudos</a></p>',
    "<p>Até a próxima aula!<br>Teacher Flávio</p>",
    "</div>",
  ];
  return { text: intro.join("\n"), html: html.join("\n") };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL") || "";
  const key = serviceKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") || "";
  const expectedSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") || "";
  if (!url || !key || !resendKey || !expectedSecret) {
    return response({ error: "Server configuration incomplete" }, 500);
  }
  if (!await authorized(request.headers.get("x-webhook-secret") || "", expectedSecret)) {
    return response({ error: "Unauthorized" }, 401);
  }
  let input: { source?: unknown };
  try { input = await request.json(); }
  catch { return response({ error: "Invalid JSON" }, 400); }
  if (input.source !== "pg_cron") {
    return response({ error: "Unexpected source" }, 400);
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Defense in depth: the feature is off until explicitly enabled in the database.
  const { data: settings, error: settingError } = await supabase
    .from("student_preparation_email_settings")
    .select("enabled")
    .eq("id", true)
    .single();
  if (settingError || !settings?.enabled) {
    return response({ ok: true, disabled: true, sent: 0 });
  }

  const { data, error } = await supabase
    .from("student_preparation_email_reminders")
    .select("id,student_id,class_number,starts_at,status,attempts")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("starts_at", { ascending: true })
    .limit(25);
  if (error) return response({ error: "Queue read failed" }, 500);

  const nextDate = tomorrow(localDate(new Date().toISOString()));
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const reminder of (data ?? []) as Reminder[]) {
    const { data: claimed, error: claimError } = await supabase
      .from("student_preparation_email_reminders")
      .update({
        status: "processing",
        attempts: reminder.attempts + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: null,
      })
      .eq("id", reminder.id)
      .eq("status", reminder.status)
      .eq("attempts", reminder.attempts)
      .select("id")
      .maybeSingle();
    if (claimError || !claimed) {
      if (claimError) failed++;
      continue;
    }

    const finish = async (
      status: "sent" | "skipped" | "failed",
      reason?: string,
    ) => {
      const { error: finishError } = await supabase
        .from("student_preparation_email_reminders")
        .update({
          status,
          sent_at: status === "sent" ? new Date().toISOString() : null,
          last_error: reason || null,
        })
        .eq("id", reminder.id)
        .eq("status", "processing");
      if (finishError) console.error("Unable to update reminder status", finishError.code);
    };

    try {
      if (localDate(reminder.starts_at) !== nextDate) {
        await finish("skipped", "not_day_before");
        skipped++;
        continue;
      }
      const { data: context, error: contextError } = await supabase
        .rpc("student_preparation_email_context_internal", {
          target_student_id: reminder.student_id,
          target_class_number: reminder.class_number,
          target_starts_at: reminder.starts_at,
        })
        .maybeSingle();
      if (contextError) throw new Error("context_lookup_failed");
      const student = context as Context | null;
      if (!student || (!student.missing_presentation && !student.missing_questions)) {
        await finish("skipped", "already_prepared_or_not_eligible");
        skipped++;
        continue;
      }

      const content = buildMessage(student, reminder.starts_at);
      const provider = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + resendKey,
          "Content-Type": "application/json",
          "Idempotency-Key": "student-preparation-" + reminder.id,
        },
        body: JSON.stringify({
          from: FROM,
          reply_to: "contato@teacherflavius.com",
          to: [student.student_email],
          subject: SUBJECT,
          text: content.text,
          html: content.html,
        }),
      });

      if (!provider.ok) {
        await finish("failed", "resend_http_" + provider.status);
        failed++;
        continue;
      }
      await finish("sent");
      sent++;
    } catch {
      await finish("failed", "internal_delivery_error");
      failed++;
    }
  }

  return response({ ok: failed === 0, sent, skipped, failed }, failed ? 207 : 200);
});
