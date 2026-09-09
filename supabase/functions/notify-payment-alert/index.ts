import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type PaymentAlert = {
  id: string;
  alert_type: string;
  severity: "warning" | "critical";
  status: "pending" | "sent" | "failed";
  attempts: number;
  details: JsonRecord;
  created_at: string;
};

type WebhookPayload = {
  type?: string;
  table?: string;
  schema?: string;
  record?: { id?: string };
};

const encoder = new TextEncoder();

const ALERT_SUBJECTS: Record<string, string> = {
  reconciliation_failure: "Alerta: falha na reconciliação de pagamento",
  reconciliation_stalled: "Alerta: reconciliação automática sem execução recente",
  duplicate_payment: "Alerta crítico: possível pagamento duplicado",
  approved_without_application: "Alerta crítico: pagamento aprovado sem baixa",
  payment_reversal: "Alerta: pagamento estornado ou contestado",
  payment_reversal_pending: "Alerta crítico: reversão de pagamento pendente",
  invalid_webhook_burst: "Alerta de segurança: webhooks inválidos do Mercado Pago",
  gateway_failure: "Alerta: falha no gateway Mercado Pago",
  chargeback_opened: "Alerta crítico: nova contestação no Mercado Pago",
};

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

function jsonResponse(body: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
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
  for (let index = 0; index < receivedBytes.length; index += 1) difference |= receivedBytes[index] ^ expectedBytes[index];
  return difference === 0;
}

function formatDate(value: string): string {
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

function cleanDetail(value: unknown): string {
  if (typeof value === "string") return value.trim().slice(0, 240);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function detailLines(alert: PaymentAlert): string[] {
  const details = alert.details ?? {};
  switch (alert.alert_type) {
    case "reconciliation_failure":
      return [
        `Falhas registradas: ${cleanDetail(details.failure_count) || "1"}`,
        `Status do pagamento: ${cleanDetail(details.payment_status) || "não informado"}`,
        `Erro: ${cleanDetail(details.error) || "não informado"}`,
      ];
    case "reconciliation_stalled":
      return [
        `Última execução bem-sucedida: ${cleanDetail(details.last_success_at) || "não registrada"}`,
        `Minutos sem execução bem-sucedida: ${cleanDetail(details.minutes_since_success) || "15+"}`,
      ];
    case "duplicate_payment":
      return [
        `Valor: ${cleanDetail(details.amount) || "não informado"}`,
        `Forma de pagamento: ${cleanDetail(details.payment_method) || "não informada"}`,
      ];
    case "payment_reversal":
    case "payment_reversal_pending":
      return [
        `Status do provedor: ${cleanDetail(details.provider_status) || "não informado"}`,
        `Detalhe: ${cleanDetail(details.status_detail) || "não informado"}`,
      ];
    case "chargeback_opened":
      return [
        `ID da contestação: ${cleanDetail(details.chargeback_id) || "não informado"}`,
        `Valor contestado: ${cleanDetail(details.amount) || "não informado"} ${cleanDetail(details.currency) || ""}`.trim(),
        `Motivo: ${cleanDetail(details.reason) || "não informado"}`,
        `Situação da documentação: ${cleanDetail(details.documentation_status) || "não informada"}`,
        `Prazo da documentação: ${cleanDetail(details.documentation_deadline) || "não informado"}`,
        `Elegível à cobertura: ${cleanDetail(details.coverage_eligible) || "não informado"}`,
      ];
    case "invalid_webhook_burst":
      return [`Webhooks inválidos nos últimos 15 minutos: ${cleanDetail(details.count_15m) || "3+"}`];
    case "gateway_failure":
      return [`Código observado: ${cleanDetail(details.code) || "falha de comunicação"}`];
    case "approved_without_application":
      return [`Status do pagamento: ${cleanDetail(details.payment_status) || "approved"}`];
    default:
      return [];
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
    console.error("Missing required environment variables for payment alerts");
    return jsonResponse({ error: "Server configuration is incomplete" }, 500);
  }

  const receivedWebhookSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!(await secretsMatch(receivedWebhookSecret, expectedWebhookSecret))) return jsonResponse({ error: "Unauthorized" }, 401);

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  if (
    !["INSERT", "UPDATE"].includes(payload.type ?? "")
    || payload.schema !== "public"
    || payload.table !== "payment_alert_notifications"
    || !payload.record?.id
  ) {
    return jsonResponse({ error: "Unexpected webhook payload" }, 400);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: alert, error: alertError } = await supabase
    .from("payment_alert_notifications")
    .select("id, alert_type, severity, status, attempts, details, created_at")
    .eq("id", payload.record.id)
    .single();
  if (alertError || !alert) return jsonResponse({ error: "Alert not found" }, 404);

  const paymentAlert = alert as PaymentAlert;
  if (paymentAlert.status === "sent") return jsonResponse({ ok: true, already_sent: true });
  if (paymentAlert.status !== "pending") return jsonResponse({ ok: true, ignored_status: paymentAlert.status });

  const attemptAt = new Date().toISOString();
  const nextAttempt = Number(paymentAlert.attempts ?? 0) + 1;
  const { error: attemptUpdateError } = await supabase
    .from("payment_alert_notifications")
    .update({ attempts: nextAttempt, last_attempt_at: attemptAt, updated_at: attemptAt, last_error: null })
    .eq("id", paymentAlert.id)
    .eq("status", "pending");
  if (attemptUpdateError) return jsonResponse({ error: "Unable to update alert attempt" }, 500);

  if (paymentAlert.details?.dry_run === true) {
    const sentAt = new Date().toISOString();
    await supabase.from("payment_alert_notifications")
      .update({ status: "sent", sent_at: sentAt, updated_at: sentAt, last_error: null })
      .eq("id", paymentAlert.id);
    return jsonResponse({ ok: true, dry_run: true });
  }

  const subject = ALERT_SUBJECTS[paymentAlert.alert_type] ?? "Alerta operacional de pagamento";
  const occurredAt = formatDate(paymentAlert.created_at);
  const severityLabel = paymentAlert.severity === "critical" ? "CRÍTICO" : "ATENÇÃO";
  const details = detailLines(paymentAlert);
  const textBody = [
    `${severityLabel}: ${subject}`,
    "",
    `Data do alerta: ${occurredAt}`,
    `Tipo: ${paymentAlert.alert_type}`,
    ...details,
    "",
    `ID do alerta: ${paymentAlert.id}`,
    "Consulte o Controle de Mensalidades no portal para investigar o caso.",
    "Por privacidade, este e-mail não inclui dados cadastrais do aluno.",
  ].join("\n");
  const detailHtml = details.length
    ? `<ul>${details.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
    : "";
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:0 auto">
      <p style="font-size:13px;font-weight:700;letter-spacing:.08em">${severityLabel}</p>
      <h1 style="font-size:22px;margin-bottom:18px">${escapeHtml(subject)}</h1>
      <p><strong>Data do alerta:</strong> ${escapeHtml(occurredAt)}</p>
      <p><strong>Tipo:</strong> ${escapeHtml(paymentAlert.alert_type)}</p>
      ${detailHtml}
      <p><strong>ID do alerta:</strong> ${escapeHtml(paymentAlert.id)}</p>
      <p>Consulte o Controle de Mensalidades no portal para investigar o caso.</p>
      <p style="margin-top:22px;color:#667085;font-size:13px">Por privacidade, este e-mail não inclui dados cadastrais do aluno.</p>
    </div>
  `;

  let resendResponse: Response;
  try {
    resendResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `payment-alert-${paymentAlert.id}`,
      },
      body: JSON.stringify({ from: fromEmail, to: [notificationEmail], subject, text: textBody, html: htmlBody }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await supabase.from("payment_alert_notifications")
      .update({ status: "failed", last_error: message.slice(0, 1000), updated_at: new Date().toISOString() })
      .eq("id", paymentAlert.id);
    return jsonResponse({ error: "Unable to contact email provider" }, 502);
  }

  if (!resendResponse.ok) {
    const providerError = `provider_http_${resendResponse.status}`;
    await supabase.from("payment_alert_notifications")
      .update({ status: "failed", last_error: providerError, updated_at: new Date().toISOString() })
      .eq("id", paymentAlert.id);
    return jsonResponse({ error: "Email provider rejected the message" }, 502);
  }

  const sentAt = new Date().toISOString();
  const { error: sentUpdateError } = await supabase.from("payment_alert_notifications")
    .update({ status: "sent", sent_at: sentAt, updated_at: sentAt, last_error: null })
    .eq("id", paymentAlert.id);
  if (sentUpdateError) return jsonResponse({ error: "Email sent but status update failed" }, 500);
  return jsonResponse({ ok: true });
});
