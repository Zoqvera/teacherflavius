import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type WebhookPayload = {
  type?: string;
  schema?: string;
  table?: string;
  record?: { id?: string };
};

type CancellationNotification = {
  id: string;
  student_id: string;
  student_name: string;
  class_name: string;
  starts_at: string;
  ends_at: string | null;
  credit_granted: boolean;
  recipient_type: "student" | "teacher";
  status: string;
  attempts: number;
  created_at: string;
};

const FROM_EMAIL = "Teacher Flávio <contato@teacherflavius.com>";
const TEACHER_EMAIL = "flaviofreitas@ufu.br";
const TIME_ZONE = "America/Sao_Paulo";
const encoder = new TextEncoder();

function secretKey(): string {
  const encoded = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (encoded) {
    try {
      const key = (JSON.parse(encoded) as { default?: unknown }).default;
      if (typeof key === "string" && key) return key;
    } catch {
      // Legacy service role configuration remains supported.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sameSecret(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(received)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const first = new Uint8Array(a);
  const second = new Uint8Array(b);
  let different = 0;
  for (let index = 0; index < first.length; index += 1) {
    different |= first[index] ^ second[index];
  }
  return different === 0;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function cleanHeader(value: unknown, fallback: string): string {
  return String(value ?? fallback).replace(/[\r\n]+/g, " ").trim().slice(0, 120) || fallback;
}

function datePart(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: TIME_ZONE,
  }).format(new Date(value));
}

function timePart(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TIME_ZONE,
  }).format(new Date(value));
}

function cancellationMessage(notification: CancellationNotification): {
  subject: string;
  text: string;
  html: string;
} {
  const teacher = notification.recipient_type === "teacher";
  const name = cleanHeader(notification.student_name, "Aluno");
  const className = cleanHeader(notification.class_name, "Turma");
  const date = datePart(notification.starts_at);
  const schedule = notification.ends_at
    ? `${timePart(notification.starts_at)} às ${timePart(notification.ends_at)}`
    : timePart(notification.starts_at);
  const creditStatus = notification.credit_granted
    ? "Cancelamento realizado com pelo menos 12 horas de antecedência. Foi disponibilizado um crédito de reposição."
    : "Cancelamento realizado com menos de 12 horas de antecedência. A vaga foi liberada, mas não foi concedido crédito de reposição.";
  const intro = teacher
    ? `O aluno ${name} cancelou uma aula regular.`
    : `Olá, ${name}! Sua aula regular foi cancelada com sucesso.`;
  const subject = teacher
    ? `Aula cancelada: ${name} — ${date}, ${timePart(notification.starts_at)}`
    : `Aula cancelada — ${date}, ${timePart(notification.starts_at)}`;
  const text = [
    intro,
    "",
    ...(teacher ? [`Aluno: ${name}`] : []),
    `Turma: ${className}`,
    `Data: ${date}`,
    `Horário: ${schedule}`,
    "",
    creditStatus,
    "Confira suas aulas e créditos na Área do Estudante.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
      <h1 style="font-size:22px;margin-bottom:18px">Aula regular cancelada</h1>
      <p>${escapeHtml(intro)}</p>
      <table style="border-collapse:collapse;width:100%;margin:18px 0">
        ${teacher ? `<tr><td style="padding:7px 12px 7px 0;font-weight:bold">Aluno</td><td>${escapeHtml(name)}</td></tr>` : ""}
        <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Turma</td><td>${escapeHtml(className)}</td></tr>
        <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Data</td><td>${escapeHtml(date)}</td></tr>
        <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Horário</td><td>${escapeHtml(schedule)}</td></tr>
      </table>
      <p>${escapeHtml(creditStatus)}</p>
      <p style="color:#667085;font-size:13px">Confira os detalhes na Área do Estudante.</p>
    </div>`;
  return { subject, text, html };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const key = secretKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const expected = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  if (!supabaseUrl || !key || !resendKey || !expected) {
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }
  if (!(await sameSecret(request.headers.get("x-webhook-secret") ?? "", expected))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }
  if (
    payload.type !== "INSERT" ||
    payload.schema !== "public" ||
    payload.table !== "regular_lesson_cancellation_email_notifications" ||
    !payload.record?.id
  ) {
    return jsonResponse({ error: "Unexpected webhook payload" }, 400);
  }

  const supabase = createClient(supabaseUrl, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("regular_lesson_cancellation_email_notifications")
    .select("id, student_id, student_name, class_name, starts_at, ends_at, credit_granted, recipient_type, status, attempts, created_at")
    .eq("id", payload.record.id)
    .single();

  if (error || !data) return jsonResponse({ error: "Notification not found" }, 404);
  const notice = data as CancellationNotification;
  if (notice.status === "sent") return jsonResponse({ ok: true, already_sent: true });
  if (notice.recipient_type !== "student" && notice.recipient_type !== "teacher") {
    return jsonResponse({ error: "Unsupported recipient" }, 422);
  }

  const fail = async (message: string): Promise<void> => {
    await supabase.from("regular_lesson_cancellation_email_notifications")
      .update({ status: "failed", last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", notice.id);
  };

  let recipient = TEACHER_EMAIL;
  if (notice.recipient_type === "student") {
    const { data: studentAuth, error: authError } = await supabase.auth.admin.getUserById(notice.student_id);
    recipient = studentAuth?.user?.email ?? "";
    if (authError || !recipient) {
      await fail(authError?.message ?? "Student verified Auth email is unavailable");
      return jsonResponse({ error: "Student email not found" }, 422);
    }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    await fail("Invalid recipient email");
    return jsonResponse({ error: "Invalid recipient email" }, 422);
  }

  const attemptedAt = new Date().toISOString();
  // Resend only retains idempotency keys for 24 hours: block uncertain late replays.
  if (notice.attempts > 0 && Date.now() - new Date(notice.created_at).getTime() > 18 * 60 * 60 * 1000) {
    return jsonResponse({ error: "Manual reconciliation required after idempotency window" }, 409);
  }

  const { data: claimed, error: claimError } = await supabase
    .from("regular_lesson_cancellation_email_notifications")
    .update({
      attempts: Number(notice.attempts ?? 0) + 1,
      last_attempt_at: attemptedAt,
      updated_at: attemptedAt,
      last_error: null,
    })
    .eq("id", notice.id)
    .eq("status", notice.status)
    .eq("attempts", notice.attempts)
    .select("id")
    .maybeSingle();
  if (claimError) return jsonResponse({ error: "Unable to claim notification" }, 500);
  if (!claimed) return jsonResponse({ ok: true, skipped: "already_claimed" });

  const message = cancellationMessage(notice);
  const providerResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `regular-cancellation-${notice.recipient_type}-${notice.id}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      reply_to: "contato@teacherflavius.com",
      to: [recipient],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });
  if (!providerResponse.ok) {
    await fail(`Resend HTTP ${providerResponse.status}`);
    return jsonResponse({ error: "Email provider rejected the message" }, 502);
  }

  const sentAt = new Date().toISOString();
  const { error: sentError } = await supabase.from("regular_lesson_cancellation_email_notifications")
    .update({ status: "sent", sent_at: sentAt, updated_at: sentAt, last_error: null })
    .eq("id", notice.id);
  if (sentError) return jsonResponse({ error: "Provider accepted email but status update failed" }, 500);
  return jsonResponse({ ok: true });
});
