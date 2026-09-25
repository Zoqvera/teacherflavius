import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type NotificationRecord = {
  id: string;
  student_id: string;
  status?: string;
  attempts?: number;
  created_at?: string;
};

type DatabaseWebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: NotificationRecord;
};

const encoder = new TextEncoder();

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

function formatEnrollmentDate(value: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function displayValue(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized || fallback;
}

function escapeHtml(value: string): string {
  const replacements: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return value.replace(/[&<>"']/g, (character) => replacements[character]);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const notificationEmail = Deno.env.get("ENROLLMENT_NOTIFICATION_EMAIL") ?? "";
  const fromEmail = Deno.env.get("ENROLLMENT_FROM_EMAIL") ?? "";
  const expectedWebhookSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";

  if (!supabaseUrl || !secretKey || !resendApiKey || !notificationEmail || !fromEmail || !expectedWebhookSecret) {
    console.error("Missing required environment variables for enrollment notification");
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
    payload.table !== "enrollment_email_notifications" ||
    !webhookRecord?.id ||
    !webhookRecord.student_id
  ) {
    return jsonResponse({ error: "Unexpected webhook payload" }, 400);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: notification, error: notificationError } = await supabase
    .from("enrollment_email_notifications")
    .select("id, student_id, status, attempts, created_at")
    .eq("id", webhookRecord.id)
    .single();

  if (notificationError || !notification) {
    console.error("Enrollment notification not found", webhookRecord.id, notificationError?.message);
    return jsonResponse({ error: "Notification not found" }, 404);
  }

  if (notification.status === "sent") return jsonResponse({ ok: true, already_sent: true });

  const attemptAt = new Date().toISOString();
  await supabase
    .from("enrollment_email_notifications")
    .update({
      attempts: Number(notification.attempts ?? 0) + 1,
      last_attempt_at: attemptAt,
      updated_at: attemptAt,
      last_error: null,
    })
    .eq("id", notification.id);

  const { data: student, error: studentError } = await supabase
    .from("profiles")
    .select("id, name, whatsapp, enrolled")
    .eq("id", notification.student_id)
    .single();

  if (studentError || !student || student.enrolled !== true) {
    const errorMessage = studentError?.message ?? "Enrolled student profile not found";
    await supabase
      .from("enrollment_email_notifications")
      .update({ status: "failed", last_error: errorMessage.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", notification.id);
    console.error("Unable to verify enrolled student", notification.id, errorMessage);
    return jsonResponse({ error: "Unable to verify enrolled student" }, 500);
  }

  const enrolledAt = formatEnrollmentDate(notification.created_at);
  const studentName = displayValue(student.name, "Não informado");
  const studentWhatsapp = displayValue(student.whatsapp, "Não informado");
  const studentNameHtml = escapeHtml(studentName);
  const studentWhatsappHtml = escapeHtml(studentWhatsapp);

  const textBody = [
    "Um novo aluno concluiu a matrícula no site.",
    "",
    `Nome: ${studentName}`,
    `WhatsApp: ${studentWhatsapp}`,
    `Data da matrícula: ${enrolledAt}`,
    "",
    "Os demais dados cadastrais permanecem disponíveis somente na Área do Professor.",
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:620px;margin:0 auto">
      <h1 style="font-size:22px;margin-bottom:18px">Nova matrícula concluída</h1>
      <p>Um novo aluno concluiu a matrícula no site.</p>
      <p><strong>Nome:</strong> ${studentNameHtml}</p>
      <p><strong>WhatsApp:</strong> ${studentWhatsappHtml}</p>
      <p><strong>Data da matrícula:</strong> ${enrolledAt}</p>
      <p style="margin-top:22px;color:#667085;font-size:13px">Este e-mail administrativo inclui somente nome, WhatsApp e data da matrícula. Os demais dados cadastrais permanecem disponíveis somente na Área do Professor.</p>
    </div>
  `;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `enrollment-${notification.id}`,
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [notificationEmail],
      subject: "Nova matrícula concluída",
      text: textBody,
      html: htmlBody,
    }),
  });

  if (!resendResponse.ok) {
    await supabase
      .from("enrollment_email_notifications")
      .update({ status: "failed", last_error: `provider_http_${resendResponse.status}`, updated_at: new Date().toISOString() })
      .eq("id", notification.id);
    console.error("Resend rejected enrollment notification", notification.id, resendResponse.status);
    return jsonResponse({ error: "Email provider rejected the message" }, 502);
  }

  const sentAt = new Date().toISOString();
  const { error: sentUpdateError } = await supabase
    .from("enrollment_email_notifications")
    .update({ status: "sent", sent_at: sentAt, updated_at: sentAt, last_error: null })
    .eq("id", notification.id);

  if (sentUpdateError) {
    console.error("Email sent but notification status update failed", notification.id, sentUpdateError.message);
    return jsonResponse({ error: "Email sent but status update failed" }, 500);
  }

  return jsonResponse({ ok: true });
});
