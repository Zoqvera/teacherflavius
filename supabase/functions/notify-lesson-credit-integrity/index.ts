import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

const ADMIN_EMAIL = "contato@teacherflavius.com";
const FROM_EMAIL = "TeacherFlavius <contato@teacherflavius.com>";
const SUBJECT = "Alerta de integridade — TeacherFlavius";
const TIME_ZONE = "America/Sao_Paulo";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type Issue = {
  issue_code: string;
  student_name: string;
  credit_id: string;
  tuition_id: string | null;
  starts_at: string | null;
};

type ClaimedRun = {
  run_id: string;
  audit_date: string;
  issue_count: number;
  issues: Issue[];
};

function getServiceKey(): string {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (typeof parsed.default === "string") return parsed.default;
    } catch { /* Fallback to legacy environment variable. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function isAuthorized(actual: string, expected: string): Promise<boolean> {
  if (!actual || !expected) return false;
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

function htmlEscape(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char] ?? char);
}

const ISSUE_LABELS: Record<string, string> = {
  duplicate_confirmed_slot: "Aula confirmada em duplicidade",
  paid_credit_without_lesson: "Mensalidade paga com crédito sem data",
  scheduled_credit_without_timestamp: "Crédito agendado sem horário",
};

function formatLessonDate(value: string | null): string {
  if (!value) return "Sem data";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sem data";
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: TIME_ZONE, dateStyle: "short", timeStyle: "short",
  }).format(date);
}

function buildEmail(run: ClaimedRun): { html: string; text: string } {
  const report = run.issues.slice(0, 100);
  const omitted = Math.max(0, run.issue_count - report.length);
  const title = `Auditoria de integridade — ${run.audit_date}`;
  const rows = report.map((issue) => ({
    name: String(issue.student_name || "Cadastro sem nome"),
    label: ISSUE_LABELS[issue.issue_code] || issue.issue_code,
    credit: String(issue.credit_id),
    date: formatLessonDate(issue.starts_at),
  }));

  const htmlRows = rows.map((item) => `<tr>
    <td style="padding:8px;border:1px solid #ddd">${htmlEscape(item.name)}</td>
    <td style="padding:8px;border:1px solid #ddd">${htmlEscape(item.label)}</td>
    <td style="padding:8px;border:1px solid #ddd">${htmlEscape(item.date)}</td>
    <td style="padding:8px;border:1px solid #ddd">${htmlEscape(item.credit)}</td>
  </tr>`).join("");
  const footer = omitted > 0
    ? `<p>Outras ${omitted} ocorrências permanecem disponíveis no histórico privado do Supabase.</p>`
    : "";
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,sans-serif;color:#222">
    <h2>${htmlEscape(title)}</h2>
    <p>Foram identificadas <strong>${run.issue_count}</strong> inconsistências em créditos de aulas.</p>
    <table style="border-collapse:collapse;width:100%">
      <thead><tr><th>Aluno</th><th>Problema</th><th>Data da aula</th><th>ID do crédito</th></tr></thead>
      <tbody>${htmlRows}</tbody>
    </table>${footer}
    <p>Esta mensagem é administrativa. Nenhuma aula ou mensalidade foi modificada.</p>
  </body></html>`;

  const lines = rows.map((item) =>
    `Aluno: ${item.name}\nProblema: ${item.label}\nData: ${item.date}\nCrédito: ${item.credit}`);
  const text = [title, `Problemas: ${run.issue_count}`, ...lines, omitted ? `Outros registros: ${omitted}` : "", "Nenhum dado acadêmico foi alterado."].filter(Boolean).join("\n\n");
  return { html, text };
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  if (!(await isAuthorized(request.headers.get("x-webhook-secret") ?? "", webhookSecret))) {
    return response({ error: "Unauthorized" }, 401);
  }

  const projectUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = getServiceKey();
  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  if (!projectUrl || !serviceKey || !resendKey) {
    return response({ error: "Notification service unavailable" }, 503);
  }

  let runId: string;
  try {
    const payload = await request.json() as { type?: string; run_id?: string };
    if (payload.type !== "lesson_credit_integrity_alert" || !UUID.test(payload.run_id ?? "")) {
      return response({ error: "Invalid payload" }, 400);
    }
    runId = payload.run_id!;
  } catch {
    return response({ error: "Invalid JSON" }, 400);
  }

  const client = createClient(projectUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.rpc("claim_lesson_credit_integrity_email_internal", {
    target_run_id: runId,
  });
  if (error) {
    console.error("Cannot claim lesson credit integrity report", error.message);
    return response({ error: "Notification claim failed" }, 500);
  }
  if (!data) return response({ ok: true, skipped: true });
  const report = data as ClaimedRun;

  async function finish(status: "sent" | "failed", errorText: string | null, providerId: string | null): Promise<void> {
    const result = await client.rpc("finish_lesson_credit_integrity_email_internal", {
      target_run_id: runId,
      target_status: status,
      target_error: errorText,
      target_provider_message_id: providerId,
    });
    if (result.error) console.error("Failed to record integrity notification result", result.error.message);
  }

  try {
    const mail = buildEmail(report);
    const result = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `lesson-integrity-${runId}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [ADMIN_EMAIL],
        reply_to: "contato@teacherflavius.com",
        subject: SUBJECT,
        html: mail.html,
        text: mail.text,
      }),
    });
    if (!result.ok) {
      const errorText = (await result.text()).slice(0, 500);
      await finish("failed", `resend_${result.status}: ${errorText}`, null);
      return response({ error: "Email provider rejected report" }, 502);
    }
    const payload = await result.json() as { id?: string };
    await finish("sent", null, payload.id ?? null);
    return response({ ok: true, sent: true });
  } catch (error) {
    await finish("failed", error instanceof Error ? error.message.slice(0, 500) : "delivery_failed", null);
    return response({ error: "Email delivery failed" }, 502);
  }
});
