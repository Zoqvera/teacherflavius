import { createClient } from "https://esm.sh/@supabase/supabase-js@2.112.3";

type ReminderKind = "before_due" | "due_today" | "after_due";
type Reminder = {
  reminder_id: string;
  tuition_id: string;
  student_id: string;
  due_date: string;
  reminder_kind: ReminderKind;
};
type Message = { subject: string; text: string; html: string };
type Outcome = "sent" | "failed" | "skipped";

const SENDER = "Financeiro Teacher Flávio <financeiro@teacherflavius.com>";
const REPLY_TO = "contato@teacherflavius.com";
const PAYMENT_URL = "https://teacherflavius.com/pagamento/";
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const encoder = new TextEncoder();

function serviceKey(): string {
  const stored = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (stored) {
    try {
      const value = (JSON.parse(stored) as { default?: unknown }).default;
      if (typeof value === "string" && value) return value;
    } catch { /* Legacy projects use SUPABASE_SERVICE_ROLE_KEY. */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function response(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function secretsMatch(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const digests = await Promise.all(
    [received, expected].map((secret) => crypto.subtle.digest("SHA-256", encoder.encode(secret))),
  );
  const left = new Uint8Array(digests[0]);
  const right = new Uint8Array(digests[1]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function formatDueDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Invalid due date");
  const [year, month, day] = value.split("-");
  return day + "/" + month + "/" + year;
}

function buildMessage(kind: ReminderKind, dueDate: string): Message {
  const date = formatDueDate(dueDate);
  const subjects: Record<ReminderKind, string> = {
    before_due: "Lembrete: sua mensalidade vence em 2 dias",
    due_today: "Sua mensalidade vence hoje",
    after_due: "Lembrete: sua mensalidade está vencida há 2 dias",
  };
  const introductions: Record<ReminderKind, string> = {
    before_due: "Sua mensalidade do Teacher Flávio vence em 2 dias, em " + date + ".",
    due_today: "Sua mensalidade do Teacher Flávio vence hoje, " + date + ".",
    after_due: "Consta em nosso sistema que a mensalidade com vencimento em " + date + " ainda está em aberto.",
  };
  const subject = subjects[kind];
  const description = introductions[kind];
  const text = [
    "Olá!",
    "",
    description,
    "Para consultar a mensalidade e realizar o pagamento, acesse:",
    PAYMENT_URL,
    "",
    "Se você já efetuou o pagamento, considere o tempo necessário para a confirmação no sistema.",
    "",
    "Teacher Flávio — Financeiro",
  ].join("\n");
  const html = [
    '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1c2533;line-height:1.6">',
    '<h2 style="color:#123d6a">Teacher Flávio — Financeiro</h2>',
    '<p>Olá!</p>',
    '<p>' + description + '</p>',
    '<p>Para consultar sua mensalidade e realizar o pagamento, utilize o link:</p>',
    '<p><a href="' + PAYMENT_URL + '" style="background:#123d6a;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none;display:inline-block">Acessar pagamento da mensalidade</a></p>',
    '<p><a href="' + PAYMENT_URL + '">' + PAYMENT_URL + '</a></p>',
    '<p style="font-size:13px;color:#556070">Se você já efetuou o pagamento, considere o tempo necessário para a confirmação no sistema.</p>',
    '</div>',
  ].join("");
  return { subject, text, html };
}

async function finish(
  supabase: ReturnType<typeof createClient>,
  reminderId: string,
  outcome: Outcome,
  providerMessageId?: string | null,
  errorCode?: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("finish_tuition_email_reminder_internal", {
    target_reminder_id: reminderId,
    target_outcome: outcome,
    target_provider_message_id: providerMessageId ?? null,
    target_error: errorCode ?? null,
  });
  return !error && data === true;
}

async function sendReminder(
  supabase: ReturnType<typeof createClient>,
  resendApiKey: string,
  reminder: Reminder,
): Promise<Outcome> {
  const { data: eligible, error: eligibilityError } = await supabase.rpc(
    "is_tuition_email_reminder_eligible_internal",
    { target_reminder_id: reminder.reminder_id },
  );
  if (eligibilityError) {
    if (!await finish(supabase, reminder.reminder_id, "failed", null, "eligibility_unavailable")) {
      throw new Error("Unable to persist eligibility failure");
    }
    return "failed";
  }
  if (eligible !== true) {
    if (!await finish(supabase, reminder.reminder_id, "skipped", null, "no_longer_eligible")) {
      throw new Error("Unable to skip paid or inactive tuition");
    }
    return "skipped";
  }

  const { data: userData, error: userError } = await supabase.auth.admin.getUserById(
    reminder.student_id,
  );
  const user = userData?.user;
  const address = user?.email?.trim() ?? "";
  if (userError || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || !user?.email_confirmed_at) {
    if (!await finish(supabase, reminder.reminder_id, "failed", null, "verified_email_unavailable")) {
      throw new Error("Unable to persist invalid recipient");
    }
    return "failed";
  }

  // Recheck after the Auth request to suppress payments or archiving during processing.
  const { data: stillEligible, error: recheckError } = await supabase.rpc(
    "is_tuition_email_reminder_eligible_internal",
    { target_reminder_id: reminder.reminder_id },
  );
  if (recheckError || stillEligible !== true) {
    const outcome: Outcome = recheckError ? "failed" : "skipped";
    if (!await finish(supabase, reminder.reminder_id, outcome, null, recheckError ? "eligibility_unavailable" : "no_longer_eligible")) {
      throw new Error("Unable to persist final eligibility check");
    }
    return outcome;
  }

  const message = buildMessage(reminder.reminder_kind, reminder.due_date);
  let accepted: Response;
  try {
    accepted = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + resendApiKey,
        "Idempotency-Key": "tuition-email-" + reminder.reminder_id,
      },
      body: JSON.stringify({
        from: SENDER,
        reply_to: REPLY_TO,
        to: [address],
        subject: message.subject,
        text: message.text,
        html: message.html,
      }),
    });
  } catch {
    if (!await finish(supabase, reminder.reminder_id, "failed", null, "provider_connection_failed")) {
      throw new Error("Unable to persist provider transport failure");
    }
    return "failed";
  }

  if (!accepted.ok) {
    if (!await finish(supabase, reminder.reminder_id, "failed", null, "provider_http_" + accepted.status)) {
      throw new Error("Unable to persist provider rejection");
    }
    return "failed";
  }

  let providerMessageId: string | null = null;
  try {
    const data = await accepted.json() as { id?: unknown };
    providerMessageId = typeof data?.id === "string" ? data.id : null;
  } catch { /* HTTP acceptance is sufficient even without a response body. */ }

  if (!await finish(supabase, reminder.reminder_id, "sent", providerMessageId)) {
    throw new Error("Provider accepted email but delivery status could not be persisted");
  }
  return "sent";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = serviceKey();
  const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const expectedSecret = Deno.env.get("ENROLLMENT_WEBHOOK_SECRET") ?? "";
  if (!supabaseUrl || !supabaseKey || !resendApiKey || !expectedSecret) {
    return response({ error: "Server configuration unavailable" }, 503);
  }
  if (!await secretsMatch(request.headers.get("x-webhook-secret") ?? "", expectedSecret)) {
    return response({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: reminders, error: claimError } = await supabase.rpc(
    "claim_tuition_email_reminders_internal",
    { target_limit: 20 },
  );
  if (claimError || !Array.isArray(reminders)) {
    return response({ error: "Unable to claim tuition reminders" }, 503);
  }

  const counters = { sent: 0, failed: 0, skipped: 0 };
  try {
    for (const reminder of reminders as Reminder[]) {
      const outcome = await sendReminder(supabase, resendApiKey, reminder);
      counters[outcome] += 1;
      // Respect the provider's send rate; retries use the same idempotency key.
      if (reminders.length > 1) {
        await new Promise((resolve) => setTimeout(resolve, 600));
      }
    }
  } catch {
    return response({ error: "Tuition email dispatch interrupted", ...counters }, 503);
  }
  return response({ ok: true, ...counters });
});
