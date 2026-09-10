import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type JsonRecord = Record<string, unknown>;

type WebhookPayload = {
  type?: string;
  schema?: string;
  table?: string;
  record?: { id?: string };
};

const encoder = new TextEncoder();

const SUBJECTS: Record<string, string> = {
  critical_application_errors: "Alerta crítico: erros de aplicação",
  http_5xx_burst: "Alerta crítico: falhas HTTP 5xx",
  http_5xx_elevated: "Alerta: falhas HTTP 5xx acima do normal",
  auth_error_burst: "Alerta: falhas de autenticação acima do normal",
  application_error_fingerprint_burst: "Alerta: erro recorrente na aplicação",
  resource_error_burst: "Alerta: falhas de carregamento de recursos",
  csp_violation_burst: "Alerta: violações CSP inesperadas",
  synthetic_availability_failure: "Alerta: indisponibilidade detectada",
  synthetic_probe_stale: "Alerta: probe de disponibilidade atrasado",
  scheduled_job_failure: "Alerta crítico: job agendado falhou",
  scheduled_jobs_stale: "Alerta: jobs agendados atrasados",
  system_health_stalled: "Alerta crítico: health check global parou",
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

function json(body: JsonRecord, status = 200): Response {
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
  const [left, right] = await Promise.all([digest(received), digest(expected)]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function clean(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 240);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function detailLines(details: JsonRecord): string[] {
  return Object.entries(details)
    .filter(([key]) => key !== "health_run_id")
    .slice(0, 12)
    .map(([key, value]) => `${key}: ${clean(value) || JSON.stringify(value).slice(0, 240)}`);
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const secretKey = getDefaultKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const notificationEmail = Deno.env.get("ENROLLMENT_NOTIFICATION_EMAIL") ?? "";
  const fromEmail = Deno.env.get("ENROLLMENT_FROM_EMAIL") ?? "";
  const expectedWebhookSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  const receivedWebhookSecret = request.headers.get("x-webhook-secret") ?? "";

  if (!supabaseUrl || !secretKey || !resendApiKey || !notificationEmail || !fromEmail || !expectedWebhookSecret) {
    console.error("Server environment is incomplete for system health alerts");
    return json({ error: "Server configuration is incomplete" }, 500);
  }
  if (!(await secretsMatch(receivedWebhookSecret, expectedWebhookSecret))) return json({ error: "Unauthorized" }, 401);

  let payload: WebhookPayload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (
    !["INSERT", "UPDATE"].includes(payload.type ?? "")
    || payload.schema !== "private"
    || payload.table !== "system_health_alerts"
    || !payload.record?.id
  ) {
    return json({ error: "Unexpected webhook payload" }, 400);
  }

  const admin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: rawAlert, error: beginError } = await admin.rpc("begin_system_health_alert_delivery_internal", {
    target_alert_id: payload.record.id,
  });
  if (beginError || !rawAlert || typeof rawAlert !== "object") {
    console.error("Unable to load system health alert", beginError?.message ?? "not found");
    return json({ error: "Alert not found" }, 404);
  }

  const alert = rawAlert as JsonRecord;
  if (alert.status === "sent") return json({ ok: true, already_sent: true });
  if (alert.status !== "pending") return json({ ok: true, ignored_status: alert.status });

  const issueCode = clean(alert.issue_code) || "system_health";
  const severity = alert.severity === "critical" ? "CRÍTICO" : "ATENÇÃO";
  const subject = SUBJECTS[issueCode] ?? "Alerta de saúde operacional do TeacherFlavius.com";
  const details = alert.details && typeof alert.details === "object" && !Array.isArray(alert.details)
    ? alert.details as JsonRecord
    : {};
  const lines = detailLines(details);
  const textBody = [
    `${severity}: ${subject}`,
    "",
    `Código: ${issueCode}`,
    ...lines,
    "",
    `ID do alerta: ${clean(alert.id)}`,
    "Consulte o painel Saúde do sistema na área de Relatórios.",
  ].join("\n");
  const htmlBody = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#172033;max-width:640px;margin:0 auto">
      <p style="font-size:13px;font-weight:700;letter-spacing:.08em">${escapeHtml(severity)}</p>
      <h1 style="font-size:22px">${escapeHtml(subject)}</h1>
      <p><strong>Código:</strong> ${escapeHtml(issueCode)}</p>
      ${lines.length ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
      <p style="font-size:12px;color:#64748b">ID do alerta: ${escapeHtml(clean(alert.id))}</p>
    </div>`;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: fromEmail, to: [notificationEmail], subject, text: textBody, html: htmlBody }),
    });

    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 400);
      await admin.rpc("finish_system_health_alert_delivery_internal", {
        target_alert_id: payload.record.id,
        target_status: "failed",
        target_error: `resend_${response.status}:${errorText}`,
      });
      return json({ error: "Unable to deliver alert" }, 502);
    }

    await admin.rpc("finish_system_health_alert_delivery_internal", {
      target_alert_id: payload.record.id,
      target_status: "sent",
      target_error: null,
    });
    return json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "delivery_failed";
    await admin.rpc("finish_system_health_alert_delivery_internal", {
      target_alert_id: payload.record.id,
      target_status: "failed",
      target_error: message,
    });
    return json({ error: "Unable to deliver alert" }, 502);
  }
});
