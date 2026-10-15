import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";
import { recordResendAcceptance } from "../_shared/resend_delivery_core.mjs";

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
const TEACHER_CANCELLATION_TYPE = "teacher_cancellation";
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
  audience: "student" | "teacher" = "teacher",
): string {
  const url = new URL("https://calendar.google.com/calendar/r/eventedit");
  url.searchParams.set("action", "TEMPLATE");
  url.searchParams.set("dates", `${formatCalendarInstant(startsAt)}/${formatCalendarInstant(endsAt)}`);
  url.searchParams.set("stz", MAKEUP_TIME_ZONE);
  url.searchParams.set("etz", MAKEUP_TIME_ZONE);
  url.searchParams.set("text", audience === "teacher"
    ? `Reposição de aula — ${studentName} (${className})`
    : `Reposição de inglês — ${className}`);
  url.searchParams.set("details", [
    ...(audience === "teacher" ? [`Aluno: ${studentName}`] : []),
    `Turma: ${className}`,
    "Reposição agendada pelo TeacherFlavius.",
    ...(meetingUrl ? [`Link da aula: ${meetingUrl}`] : []),
  ].join("\n"));
  if (meetingUrl) url.searchParams.set("location", meetingUrl);
  return url.toString();
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n")
    .replace(/;/g, "\\;").replace(/,/g, "\\,");
}

function foldIcsLines(lines: string[]): string {
  const folded: string[] = [];
  for (const line of lines) {
    let part = "";
    let length = 0;
    for (const character of line) {
      const bytes = encoder.encode(character).length;
      if (length + bytes > 75) {
        folded.push(part);
        part = " " + character;
        length = bytes + 1;
      } else {
        part += character;
        length += bytes;
      }
    }
    folded.push(part);
  }
  return folded.join("\r\n") + "\r\n";
}

function makeIcsAttachment(
  studentId: string,
  classNumber: number,
  className: string,
  startsAt: string,
  endsAt: string,
  meetingUrl: string,
  createdAt: string,
): { filename: string; content: string; content_type: string } {
  const uid = `reposicao-${studentId}-${classNumber}-${formatCalendarInstant(startsAt)}@teacherflavius.com`;
  const title = `Reposição de inglês — ${className}`;
  const description = [
    `Turma: ${className}`,
    "Reposição agendada pelo TeacherFlavius.",
    `Link da aula: ${meetingUrl}`,
  ].join("\n");
  const content = foldIcsLines([
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TeacherFlavius//Reposicoes//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatCalendarInstant(createdAt)}`,
    `DTSTART:${formatCalendarInstant(startsAt)}`,
    `DTEND:${formatCalendarInstant(endsAt)}`,
    `SUMMARY:${escapeIcsText(title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(meetingUrl)}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ]);
  const bytes = encoder.encode(content);
  const base64 = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
  return {
    filename: "reposicao-aula.ics",
    content: base64,
    content_type: "text/calendar; charset=utf-8",
  };
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
  // Resend retains idempotency keys for 24 hours. Do not auto-replay uncertain older sends.
  if (Number(notification.attempts ?? 0) > 0
    && Date.now() - new Date(notification.created_at).getTime() > 18 * 60 * 60 * 1000) {
    return jsonResponse({ error: "Manual reconciliation required after idempotency window" }, 409);
  }
  const { data: claimed, error: claimError } = await supabase
    .from("makeup_class_email_notifications")
    .update({
      attempts: Number(notification.attempts ?? 0) + 1,
      last_attempt_at: attemptAt,
      updated_at: attemptAt,
      last_error: null,
    })
    .eq("id", notification.id)
    .eq("status", notification.status)
    .eq("attempts", notification.attempts)
    .select("id")
    .maybeSingle();
  if (claimError) return jsonResponse({ error: "Unable to claim notification" }, 500);
  if (!claimed) return jsonResponse({ ok: true, skipped: "already_claimed" });

  const { data: booking, error: bookingError } = await supabase
    .from("makeup_class_bookings")
    .select("id, slot_id, student_id, class_number, student_name, student_email, class_name, meeting_url, status")
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
  const isTeacherCancellation = notificationType === TEACHER_CANCELLATION_TYPE;
  const isCancellation = notificationType === "cancellation" || isTeacherCancellation;
  const isTeacherBooking = notificationType === TEACHER_BOOKING_TYPE;
  const isTeacherNotice = isTeacherBooking || isTeacherCancellation;

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

  // Only the authenticated profile classification grants calendar actions to teachers.
  // Unclassified and QUINTETO students never produce teacher calendar invites.
  let isIndividualStudent = false;
  if (isTeacherNotice) {
    const { data: studentProfile, error: profileError } = await supabase
      .from("profiles")
      .select("class_type")
      .eq("id", booking.student_id)
      .single();
    if (profileError || !studentProfile) {
      await failNotification("Student classification could not be verified");
      return jsonResponse({ error: "Student classification unavailable" }, 500);
    }
    isIndividualStudent = String(studentProfile.class_type ?? "").trim().toUpperCase() === "INDIVIDUAL";
  }

  // Administrative notifications always go to the approved professor mailbox.
  const teacherEmail = "flaviofreitas@ufu.br";
  const recipientEmail = safeHeader(
    isTeacherNotice ? teacherEmail : booking.student_email,
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

  if (isTeacherCancellation) {
    subject = `Reposição cancelada: ${studentName} — ${classDate}, ${startTime}`;
    textBody = [
      `O aluno ${studentName} cancelou uma reposição.`,
      "",
      `Aluno: ${studentName}`,
      `Turma: ${className}`,
      `Data: ${classDate}`,
      `Horário: ${schedule}`,
      "",
      "A vaga da reposição foi liberada.",
      ...(isIndividualStudent ? ["Se você salvou o compromisso no Google Agenda, remova-o manualmente."] : []),
    ].join("\n");

    htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
        <h1 style="font-size:22px;margin-bottom:18px">Reposição cancelada pelo aluno</h1>
        <p>O aluno <strong>${escapeHtml(studentName)}</strong> cancelou uma reposição.</p>
        <table style="border-collapse:collapse;width:100%;margin:18px 0">
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Aluno</td><td>${escapeHtml(studentName)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Turma</td><td>${escapeHtml(className)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Data</td><td>${escapeHtml(classDate)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Horário</td><td>${escapeHtml(schedule)}</td></tr>
        </table>
        <p>A vaga da reposição foi liberada.</p>
        ${isIndividualStudent
          ? '<p style="color:#667085;font-size:13px">Se o evento foi salvo na sua agenda, remova-o manualmente.</p>'
          : ""}
      </div>
    `;
  } else if (isTeacherBooking) {
    const calendarUrl = isIndividualStudent
      ? makeGoogleCalendarUrl(
        studentName,
        className,
        slot.starts_at,
        slot.ends_at,
        meetingUrl,
      )
      : null;
    subject = `Nova reposição: ${studentName} — ${classDate}, ${startTime}`;
    textBody = [
      "Um aluno agendou uma reposição.",
      "",
      `Aluno: ${studentName}`,
      `Turma: ${className}`,
      `Data: ${classDate}`,
      `Horário: ${schedule}`,
      `Link da aula: ${meetingUrl}`,
      ...(calendarUrl
        ? ["", `Adicionar ao Google Agenda: ${calendarUrl}`, "",
          "O evento só será criado na sua agenda após você confirmar o salvamento no Google Agenda."]
        : []),
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
        ${calendarUrl
          ? `<p style="margin:24px 0">
               <a href="${escapeHtml(calendarUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">Adicionar ao Google Agenda</a>
             </p>`
          : ""}
        <p style="font-size:14px"><a href="${escapeHtml(meetingUrl)}">Abrir link da aula</a></p>
        ${calendarUrl
          ? '<p style="color:#667085;font-size:13px">Revise e salve o evento no Google Agenda. O evento não é atualizado automaticamente se a reposição for cancelada.</p>'
          : ""}
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
      "Se você salvou a reposição no seu calendário, remova o evento manualmente.",
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
        <p style="color:#667085;font-size:13px">A vaga foi liberada e está novamente disponível. Se você salvou esta reposição no seu calendário, remova o evento manualmente.</p>
      </div>
    `;
  } else {
    const studentCalendarUrl = makeGoogleCalendarUrl(
      studentName,
      className,
      slot.starts_at,
      slot.ends_at,
      meetingUrl,
      "student",
    );
    subject = `Reposição agendada — ${classDate}, ${startTime}`;
    textBody = [
      `Olá, ${studentName}!`,
      "",
      "Sua aula de reposição está agendada. Você pode cancelar esta reposição até o início da aula. Com pelo menos 12 (doze) horas de antecedência, o crédito utilizado será devolvido. Se cancelar depois desse prazo, a vaga será liberada, mas o crédito não será devolvido. Se não cancelar nem comparecer, a aula será considerada realizada.",
      "",
      `Turma: ${className}`,
      `Data: ${classDate}`,
      `Horário: ${schedule}`,
      `Link da aula: ${meetingUrl}`,
      `Adicionar ao Google Agenda: ${studentCalendarUrl}`,
      "",
      "O compromisso será incluído na agenda somente após você confirmar o salvamento.",
      "Guarde esta mensagem para acessar a aula no horário marcado.",
    ].join("\n");

    htmlBody = `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
        <h1 style="font-size:22px;margin-bottom:18px">Reposição de aula confirmada</h1>
        <p>Olá, <strong>${escapeHtml(studentName)}</strong>!</p>
        <p>Sua aula de reposição está agendada. Você pode cancelar esta reposição até o início da aula. Com pelo menos 12 (doze) horas de antecedência, o crédito utilizado será devolvido. Se cancelar depois desse prazo, a vaga será liberada, mas o crédito não será devolvido. Se não cancelar nem comparecer, a aula será considerada realizada.</p>
        <table style="border-collapse:collapse;width:100%;margin:18px 0">
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Turma</td><td>${escapeHtml(className)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Data</td><td>${escapeHtml(classDate)}</td></tr>
          <tr><td style="padding:7px 12px 7px 0;font-weight:bold">Horário</td><td>${escapeHtml(schedule)}</td></tr>
        </table>
        <p style="margin:24px 0">
          <a href="${escapeHtml(meetingUrl)}" style="display:inline-block;background:#6366f1;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">Entrar na aula</a>
        </p>
        <p style="margin:20px 0">
          <a href="${escapeHtml(studentCalendarUrl)}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px;font-weight:bold">Adicionar ao Google Agenda</a>
        </p>
        <p style="color:#667085;font-size:13px">Revise e salve o compromisso no Google Agenda. O link de videoaula é o mesmo cadastrado pelo professor.</p>
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
      reply_to: "contato@teacherflavius.com",
      to: [recipientEmail],
      subject,
      text: textBody,
      html: htmlBody,
      ...(notificationType === "booking_confirmation" ? {
        attachments: [makeIcsAttachment(
          booking.student_id,
          booking.class_number,
          className,
          slot.starts_at,
          slot.ends_at,
          meetingUrl!,
          notification.created_at,
        )],
      } : {}),
    }),
  });

  if (!resendResponse.ok) {
    const resendError = (await resendResponse.text()).slice(0, 1000);
    await failNotification(resendError);
    console.error("Resend rejected makeup notification", notification.id, resendResponse.status);
    return jsonResponse({ error: "Email provider rejected the message" }, 502);
  }

  if (Deno.env.get("RESEND_DELIVERY_TRACKING_ENABLED") === "true") {
    const recipientRole = [TEACHER_BOOKING_TYPE, TEACHER_CANCELLATION_TYPE]
      .includes(notificationType) ? "teacher" : "student";
    const tracked = await recordResendAcceptance(supabase, resendResponse, {
      queueName: "makeup", notificationId: notification.id, recipientRole,
    });
    if (!tracked) {
      await failNotification("resend_tracking_unavailable");
      return jsonResponse({ error: "Unable to record provider acceptance" }, 503);
    }
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