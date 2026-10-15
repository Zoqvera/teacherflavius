import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type NotificationRecord = {
  id: string;
  booking_id: string;
};

type DatabaseWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
};

const encoder = new TextEncoder();
const MAKEUP_FROM_EMAIL = "Teacher Flávio <contato@teacherflavius.com>";
const TEACHER_BOOKING_TYPE = "teacher_booking";
const MAKEUP_TIME_ZONE = "America/Sao_Paulo";

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

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function digest(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

async function secretsMatch(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const [receivedDigest, expectedDigest] = await Promise.all([digest(received), digest(expected)]);
  const receivedBytes = new Uint8Array(receivedDigest);
  const expectedBytes = new Uint8Array(expectedDigest);
  if (receivedBytes.length !== expectedBytes.length) return false;

  let difference = 0;
  for (let index = 0; index < receivedBytes.length; index += 1) {
    difference |= receivedBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
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

function safeHeader(value: unknown, fallback: string): string {
  return String(value ?? fallback).replace(/[\r\n]+/g, " ").trim().slice(0, 120) || fallback;
}

function safeHttpUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value ?? ""));
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: MAKEUP_TIME_ZONE,
  }).format(new Date(value));
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: MAKEUP_TIME_ZONE,
  }).format(new Date(value));
}

function formatCalendarInstant(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid lesson timestamp");
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function makeGoogleCalendarUrl(
  studentName: string,
  className: string,
  startsAt: string,
  endsAt: string,
  meetingUrl: string | null,
): string {
  const url = new URL("https://calendar.google.com/calendar/r/eventedit");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("dates", `${formatCalendarInstant(startsAt)}/${formatCalendarInstant(endsAt)}`);
  url.searchParams.set("stz", MAKEUP_TIME_ZONE);
  url.searchParams.set("etz", MAKEUP_TIME_ZONE);
  url.searchParams.set("text", `Reposição de aula — ${studentName} (${className})`);
  url.searchParams.set("details", [
    `Aluno: ${studentName}`,
    `Turma: ${className}`,
    "Agendamento de reposição pelo TeacherFlavius.",
    ...(meetingUrl ? [`Link da aula: ${meetingUrl}`] : []),
  ].join("\n"));
  if (meetingUrl) url.searchParams.set("location", meetingUrl);
  return url.toString();
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const expectedWebhookSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";

  if (!supabaseUrl || !secretKey || !resendApiKey || !expectedWebhookSecret) {
    console.error("Missing required environment variables for makeup booking notification");
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  const receivedWebhookSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!(await secretsMatch(receivedWebhookSecret, expectedWebhookSecret))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let payload: DatabaseWebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const webhookRecord = payload.record;
  if (
    payload.type !== "INSERT" ||
    payload.schema !== "public" ||
    payload.table !== "makeup_class_email_notifications" ||
    !webhookRecord?.id ||
    !webhookRecord.booking_id
  ) {
    return jsonResponse({ error: "Unexpected webhook payload" }, 400);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: notification, error: notificationError } = await supabase
    .from("makeup_class_email_notifications")
    .select("id, booking_id, notification_type, status, attempts, created_at")
    .eq("id", webhookRecord.id)
    .single();

  if (notificationError || !notification) {
    console.error("Makeup notification not found", webhookRecord.id, notificationError?.message);
    return jsonResponse({ error: "Notification not found" }, 404);
  }

  if (notification.status === "sent") return jsonResponse({ ok: true, already_sent: true });

  const attemptAt = new Date().toISOString();
  await supabase
    .from("makeup_class_email_notifications")
    .update({
      attempts: Number(notification.attempts ?? 0) + 1,
      last_attempt_at: attemptAt,
      updated_at: attemptAt,
      last_error: null,
    })
    .eq("id", notification.id);

  const { data: booking, error: bookingError } = await supabase
    .from("makeup_class_bookings")
    .select("id, slot_id, student_name, student_email, class_name, meeting_url, status")
    .eq("id", notification.booking_id)
    .single();

  const failNotification = async (message: string) => {
    await supabase
      .from("makeup_class_email_notifications")
      .update({ status: "failed", last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", notification.id);
  };

  if (bookingError || !booking) {
    const message = bookingError?.message ?? "Booking not found";
    await failNotification(message);
    return jsonResponse({ error: "Booking not found" }, 404);
  }

  const notificationType = String(notification.notification_type ?? "");
  const isCancellation = notificationType === "cancellation";
  const isTeacherBooking = notificationType === TEACHER_BOOKING_TYPE;

  if (notificationType !== "booking_confirmation" && !isCancellation && !isTeacherBooking) {
    await failNotification("Unsupported notification type");
    return jsonResponse({ error: "Unsupported notification type" }, 422);
  }

  if (!isCancellation && booking.status !== "confirmed") {
    await failNotification("Booking was cancelled before the confirmation email was sent");
    return jsonResponse({ ok: true, skipped: "cancelled_booking" });
  }

  if (isCancellation && booking.status !== "cancelled") {
    await failNotification("Cancellation email requested for a booking that is not cancelled");
    return jsonResponse({ ok: true, skipped: "booking_not_cancelled" });
  }

  const { data: slot, error: slotError } = await supabase
    .from("makeup_class_slots")
    .select("starts_at, ends_at")
    .eq("id", booking.slot_id)
    .single();

  if (slotError || !slot) {
    const message = slotError?.message ?? "Schedule slot not found";
    await failNotification(message);
    return jsonResponse({ error: "Schedule slot not found" }, 404);
  }

  const teacherEmail = Deno.env.get("MAKEUP_TEACHER_NOTIFICATION_EMAIL")
    || Deno.env.get("ENROLLMENT_NOTIFICATION_EMAIL")
    || "contato@teacherflavius.com";
  const recipientEmail = safeHeader(
    isTeacherBooking ? teacherEmail : booking.student_email,
    "",
  );
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    await failNotification("Notification recipient email is invalid");
    return jsonResponse({ error: "Notification recipient email is invalid" }, 422);
  }
  const studentName = safeHeader(booking.student_name, "Aluno");
  const className = safeHeader(booking.class_name, "Turma");
  const meetingUrl = safeHttpUrl(booking.meeting_url);

  if (!recipientEmail || (!isCancellation && !meetingUrl)) {
    await failNotification(!recipientEmail ? "Notification recipient email is missing" : "Meeting URL is invalid");
    return jsonResponse({ error: "Booking contact data is incomplete" }, 422);
  }

  const classDate = formatDate(slot.starts_at);
  const startTime = formatTime(slot.starts_at);
  const endTime = formatTime(slot.ends_at);
  const schedule = `${startTime} às ${endTime}`;

  let subject: string;
  let textBody: string;
  let htmlBody: string;

  if (isTeacherBooking) {
    const calendarUrl = makeGoogleCalendarUrl(
      studentName,
      className,
      slot.starts_at,
      slot.ends_at,
      meetingUrl,
    );
    subject = `Nova reposição: ${studentName} — ${classDate}, ${startTime}`;
    textBody = [
      "Um aluno agendou uma reposição.",
      "",
      `Aluno: ${studentName}`,
      `Turma: ${className}`,
      `Data: ${classDate}`,
      `Horário: ${schedule}`,
      `Link da aula: ${meetingUrl}`,
      "",
      `Adicionar ao Google Agenda: ${calendarUrl}`,
      "",
      "O evento só será criado na sua agenda após você confirmar o salvamento no Google Agenda.",
    ].join("\n");

    htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
        <h1 style="font-size:22px;margin-bottom:18px">Nova reposição agendada</h1>
        <p>Um aluno confirmou uma reposição de aula.</p>
        <table style="border-collapse:collapse;width:100%;margin:18px 0">
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Aluno</td><td>${escapeHtml(studentName)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Turma</td><td>${escapeHtml(className)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Data</td><td>${escapeHtml(classDate)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Horário</td><td>${escapeHtml(schedule)}</td></tr>
        </table>
        <p style="margin:24px 0">
          <a href="${escapeHtml(calendarUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">Adicionar ao Google Agenda</a>
        </p>
        <p style="font-size:14px"><a href="${escapeHtml(meetingUrl)}">Abrir link da aula</a></p>
        <p style="color:#667085;font-size:13px">Revise e salve o evento no Google Agenda. O evento não é atualizado automaticamente se a reposição for cancelada.</p>
      </div>
    `;
  } else if (isCancellation) {
    subject = `Reposição cancelada — ${classDate}, ${startTime}`;
    textBody = [
      `Olá, ${studentName}!`,
      "",
      "Sua reposição de aula foi cancelada.",
      "",
      `Turma: ${className}`,
      `Data: ${classDate}`,
      `Horário: ${schedule}`,
      "",
      "A vaga foi liberada e está novamente disponível.",
    ].join("\n");

    htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
        <h1 style="font-size:22px;margin-bottom:18px">Reposição de aula cancelada</h1>
        <p>Olá, <strong>${escapeHtml(studentName)}</strong>!</p>
        <p>Sua reposição foi cancelada com sucesso.</p>
        <table style="border-collapse:collapse;width:100%;margin:18px 0">
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Turma</td><td>${escapeHtml(className)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Data</td><td>${escapeHtml(classDate)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Horário</td><td>${escapeHtml(schedule)}</td></tr>
        </table>
        <p style="color:#667085;font-size:13px">A vaga foi liberada e está novamente disponível.</p>
      </div>
    `;
  } else {
    subject = `Reposição agendada — ${classDate}, ${startTime}`;
    textBody = [
      `Olá, ${studentName}!`,
      "",
      "Sua aula de reposição está agendada. Você pode cancelar esse agendamento até 12 (doze) horas antes do horário da aula. Se você não cancelar o agendamento e não comparecer à aula, a aula será considerada como aula dada.",
      "",
      `Turma: ${className}`,
      `Data: ${classDate}`,
      `Horário: ${schedule}`,
      `Link da aula: ${meetingUrl}`,
      "",
      "Guarde esta mensagem para acessar a aula no horário marcado.",
    ].join("\n");

    htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
        <h1 style="font-size:22px;margin-bottom:18px">Reposição de aula confirmada</h1>
        <p>Olá, <strong>${escapeHtml(studentName)}</strong>!</p>
        <p>Sua aula de reposição está agendada. Você pode cancelar esse agendamento até 12 (doze) horas antes do horário da aula. Se você não cancelar o agendamento e não comparecer à aula, a aula será considerada como aula dada.</p>
        <table style="border-collapse:collapse;width:100%;margin:18px 0">
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Turma</td><td>${escapeHtml(className)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Data</td><td>${escapeHtml(classDate)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Horário</td><td>${escapeHtml(schedule)}</td></tr>
        </table>
        <p style="margin:24px 0">
          <a href="${escapeHtml(meetingUrl)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">Entrar na aula</a>
        </p>
        <p style="color:#667085;font-size:13px">Este é o mesmo link de videoaula cadastrado pelo professor para sua turma.</p>
      </div>
    `;
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `makeup-${notificationType}-${notification.id}`,
    },
    body: JSON.stringify({
      from: MAKEUP_FROM_EMAIL,
      to: [recipientEmail],
      subject,
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!resendResponse.ok) {
    const resendError = (await resendResponse.text()).slice(0, 1000);
    await failNotification(resendError);
    console.error("Resend rejected makeup notification", notification.id, resendResponse.status);
    return jsonResponse({ error: "Email provider rejected the message" }, 502);
  }

  const sentAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("makeup_class_email_notifications")
    .update({ status: "sent", sent_at: sentAt, updated_at: sentAt, last_error: null })
    .eq("id", notification.id);

  if (updateError) {
    console.error("Email sent but makeup notification status update failed", notification.id, updateError.message);
    return jsonResponse({ error: "Email sent but status update failed" }, 500);
  }

  return jsonResponse({ ok: true });
});