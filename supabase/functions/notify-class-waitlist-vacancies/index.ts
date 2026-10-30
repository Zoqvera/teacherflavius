import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type Applicant = { name: string; whatsapp: string };
type VacancyNotification = {
  notification_id: string;
  class_number: number;
  class_weekday: number;
  class_start_time: string;
  available_spots: number;
  applicants: Applicant[];
};
type DeliveryOutcome = "sent" | "failed";

const RECIPIENT = "contato@teacherflavius.com";
const SENDER = "Teacher Flávio <contato@teacherflavius.com>";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const TEACHER_WAITLIST_URL = "https://teacherflavius.com/reservas-de-turmas/";
const weekdays = ["", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"];

function getServiceKey(): string {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    try {
      const candidate = (JSON.parse(keys) as { default?: unknown }).default;
      if (typeof candidate === "string" && candidate) return candidate;
    } catch { /* Support the existing legacy secret. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function respond(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function equalSecrets(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const digests = await Promise.all([received, expected].map((value) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  ));
  const first = new Uint8Array(digests[0]);
  const second = new Uint8Array(digests[1]);
  let diff = 0;
  for (let index = 0; index < first.length; index++) diff |= first[index] ^ second[index];
  return diff === 0;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const escapes: Record<string, string> = {
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    };
    return escapes[character];
  });
}

function describeClass(notification: VacancyNotification): string {
  const weekday = weekdays[notification.class_weekday] ?? "dia a confirmar";
  const [hour, minute] = String(notification.class_start_time).split(":");
  const time = hour.padStart(2, "0") + "h" + (minute !== "00" ? minute : "");
  return weekday + " às " + time + " (turma " + notification.class_number + ")";
}

function validApplicants(value: Applicant[]): Applicant[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) =>
    item && typeof item.name === "string" && item.name.trim().length >= 2 &&
    typeof item.whatsapp === "string" && /^[0-9]{10,11}$/.test(item.whatsapp)
  );
}

function buildEmail(notification: VacancyNotification) {
  const title = describeClass(notification);
  const contacts = validApplicants(notification.applicants);
  const summary = notification.available_spots === 1
    ? "1 vaga disponível" : notification.available_spots + " vagas disponíveis";
  const subject = "Lista de espera: " + summary + " — " + title;
  const lines = contacts.map((person) =>
    person.name.trim() + " — WhatsApp: +55 " + person.whatsapp +
    " — https://wa.me/55" + person.whatsapp
  );
  const text = [
    "Uma vaga foi liberada para a turma " + title + ".",
    "Disponibilidade atualizada: " + summary + ".",
    "A lista de espera não reserva vagas. Consulte a disponibilidade antes de chamar os alunos.",
    "", "Interessados na lista de espera:", ...lines,
    "", "Painel de interessados: " + TEACHER_WAITLIST_URL,
  ].join("\n");
  const htmlContacts = contacts.map((person) => {
    const number = "55" + person.whatsapp;
    return "<li><strong>" + escapeHtml(person.name.trim()) + "</strong> — " +
      escapeHtml("+55 " + person.whatsapp) +
      ' — <a href="https://wa.me/' + number + '">Chamar pelo WhatsApp</a></li>';
  }).join("");
  const html = '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#172333">' +
    "<h2>Vaga disponível — lista de espera</h2>" +
    "<p><strong>Turma:</strong> " + escapeHtml(title) + "</p>" +
    "<p><strong>Vagas:</strong> " + escapeHtml(summary) + "</p>" +
    "<p>Os interessados abaixo não possuem vaga reservada. Confirme a disponibilidade antes de convidar alguém.</p>" +
    "<ul>" + htmlContacts + "</ul>" +
    '<p><a href="' + TEACHER_WAITLIST_URL + '">Consultar lista de espera</a></p></div>';
  return { subject, text, html };
}

async function finish(
  supabase: ReturnType<typeof createClient>,
  id: string,
  outcome: DeliveryOutcome,
  providerId?: string,
  errorCode?: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("finish_class_waitlist_vacancy_email_internal", {
    target_notification_id: id,
    target_outcome: outcome,
    target_provider_message_id: providerId ?? null,
    target_error: errorCode ?? null,
  });
  if (error || data !== true) throw new Error("Unable to record the vacancy notification");
}

async function send(
  supabase: ReturnType<typeof createClient>,
  resendKey: string,
  notification: VacancyNotification,
): Promise<DeliveryOutcome> {
  const contacts = validApplicants(notification.applicants);
  if (!contacts.length) {
    await finish(supabase, notification.notification_id, "failed", undefined, "invalid_contacts");
    return "failed";
  }
  const message = buildEmail(notification);
  let response: Response;
  try {
    response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + resendKey,
        "Content-Type": "application/json",
        "Idempotency-Key": "class-waitlist-" + notification.notification_id,
      },
      body: JSON.stringify({ from: SENDER, to: [RECIPIENT], reply_to: RECIPIENT, ...message }),
    });
  } catch {
    await finish(supabase, notification.notification_id, "failed", undefined, "resend_connection");
    return "failed";
  }
  if (!response.ok) {
    await finish(supabase, notification.notification_id, "failed", undefined, "resend_http_" + response.status);
    return "failed";
  }
  let providerId: string | undefined;
  try {
    const result = await response.json() as { id?: unknown };
    if (typeof result.id === "string") providerId = result.id;
  } catch { /* Provider accepted the request. */ }
  await finish(supabase, notification.notification_id, "sent", providerId);
  return "sent";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return respond({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = getServiceKey();
  const providerKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const expected = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  if (!url || !key || !providerKey || !expected) {
    return respond({ error: "Server configuration unavailable" }, 503);
  }
  if (!await equalSecrets(request.headers.get("x-webhook-secret") ?? "", expected)) {
    return respond({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("claim_class_waitlist_vacancy_emails_internal", {
    target_limit: 10,
  });
  if (error || !Array.isArray(data)) return respond({ error: "Notification queue unavailable" }, 503);
  const totals = { sent: 0, failed: 0 };
  try {
    for (const item of data as VacancyNotification[]) {
      const outcome = await send(supabase, providerKey, item);
      totals[outcome]++;
      if (data.length > 1) await new Promise((resolve) => setTimeout(resolve, 600));
    }
  } catch {
    return respond({ error: "Email dispatch interrupted", ...totals }, 503);
  }
  return respond({ ok: true, ...totals });
});
