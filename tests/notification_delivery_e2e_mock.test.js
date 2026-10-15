"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");

const notifierPath = path.join(
  __dirname, "..", "supabase/functions/notify-makeup-booking/index.ts",
);
const WEBHOOK_SECRET = "isolated-fixture-webhook-secret";
const FIXTURE_NOW = new Date().toISOString();
const FIXTURE_START = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
const FIXTURE_END = new Date(Date.now() + 73 * 3600 * 1000).toISOString();

function createNotificationFixture(options = {}) {
  const notification = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    booking_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    notification_type: options.notificationType || "teacher_booking",
    status: "pending",
    attempts: 0,
    created_at: options.createdAt || FIXTURE_NOW,
  };
  const booking = {
    id: notification.booking_id,
    slot_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    student_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    class_number: 24,
    student_name: "Aluno de Teste",
    student_email: "aluno@example.test",
    class_name: "Turma de teste",
    meeting_url: "https://meet.google.com/test-lesson",
    status: options.bookingStatus || "confirmed",
  };
  const slot = { id: booking.slot_id, starts_at: FIXTURE_START, ends_at: FIXTURE_END };
  const profile = options.noProfile ? null : {
    id: booking.student_id,
    class_type: options.classType === undefined ? "INDIVIDUAL" : options.classType,
  };

  const records = {
    makeup_class_email_notifications: notification,
    makeup_class_bookings: booking,
    makeup_class_slots: slot,
    profiles: profile,
  };

  class Query {
    constructor(table) {
      this.table = table;
      this.conditions = [];
      this.patch = null;
    }

    select() {
      return this;
    }

    update(values) {
      this.patch = values;
      return this;
    }

    eq(field, expected) {
      this.conditions.push([field, expected]);
      return this;
    }

    execute() {
      const record = records[this.table];
      const found = Boolean(record)
        && this.conditions.every(([field, expected]) => record[field] === expected);
      if (!found) return { data: null, error: { message: "Missing fixture row" } };
      if (this.patch) Object.assign(record, this.patch);
      return { data: { ...record }, error: null };
    }

    single() {
      return Promise.resolve(this.execute());
    }

    maybeSingle() {
      if (this.patch) {
        const result = this.execute();
        return Promise.resolve(result.error ? { data: null, error: null } : result);
      }
      return Promise.resolve(this.execute());
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  const sent = [];
  let failuresLeft = Number(options.providerFailures || 0);
  const supabase = { from: (table) => new Query(table) };
  const environment = {
    SUPABASE_URL: "https://fixture.supabase.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "isolated-fixture-service-key",
    RESEND_API_KEY: "isolated-fixture-resend-key",
    ENROLLMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };
  let handler;
  const deno = {
    env: { get: (name) => environment[name] || null },
    serve: (callback) => { handler = callback; },
  };
  const fakeFetch = async (url, options) => {
    assert.equal(url, "https://api.resend.com/emails", "no external API other than mocked Resend");
    const message = JSON.parse(options.body);
    sent.push({ message, key: options.headers["Idempotency-Key"] });
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      return new Response("simulated delivery rejection", { status: 502 });
    }
    return new Response(JSON.stringify({ id: "mock-resend-message" }), { status: 200 });
  };

  const typescript = fs.readFileSync(notifierPath, "utf8");
  const strippedImport = typescript.replace(
    /^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@[^"]+";\r?\n/,
    "",
  );
  assert.ok(strippedImport.length < typescript.length, "strip only the known external SDK import");
  const script = stripTypeScriptTypes(strippedImport);
  vm.runInNewContext(script, {
    Deno: deno,
    createClient: () => supabase,
    fetch: fakeFetch,
    crypto: require("node:crypto").webcrypto,
    TextEncoder,
    Response,
    URL,
    Date,
    Intl,
    btoa: (binary) => Buffer.from(binary, "binary").toString("base64"),
    console: { error() {}, warn() {}, log() {} },
  }, { timeout: 3000, filename: "notify-makeup-booking.ts (mocked)" });

  assert.equal(typeof handler, "function");
  function request(type = notification.notification_type, overrides = {}) {
    return handler(new Request("https://fixture.supabase.invalid/functions/v1/notify-makeup-booking", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": overrides.secret === undefined ? WEBHOOK_SECRET : overrides.secret,
      },
      body: JSON.stringify(overrides.payload || {
        type: "INSERT",
        table: "makeup_class_email_notifications",
        schema: "public",
        record: { id: notification.id, booking_id: booking.id },
      }),
    }));
  }

  return { request, sent, notification, booking, slot, profile };
}

test("individual booking: teacher email offers manual Google Agenda action without ICS", async () => {
  const fixture = createNotificationFixture({ classType: "INDIVIDUAL" });
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(fixture.notification.status, "sent");
  assert.equal(fixture.notification.attempts, 1);
  assert.equal(fixture.sent.length, 1);
  const { message, key } = fixture.sent[0];
  assert.deepEqual(message.to, ["flaviofreitas@ufu.br"]);
  assert.equal(message.reply_to, "contato@teacherflavius.com");
  assert.match(message.html, /Adicionar ao Google Agenda/);
  assert.match(message.text, /Adicionar ao Google Agenda: https:\/\/calendar\.google\.com/);
  assert.match(message.text, /O evento só será criado na sua agenda após você confirmar/);
  assert.equal(message.attachments, undefined);
  assert.equal(key, "makeup-teacher_booking-" + fixture.notification.id);
});

test("quinteto booking: teacher notice has no Google Agenda invitation or ICS", async () => {
  const fixture = createNotificationFixture({ classType: "QUINTETO" });
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(fixture.sent.length, 1);
  const { message } = fixture.sent[0];
  assert.deepEqual(message.to, ["flaviofreitas@ufu.br"]);
  assert.match(message.text, /Aluno: Aluno de Teste/);
  assert.match(message.text, /Turma: Turma de teste/);
  assert.doesNotMatch(message.text + message.html, /Google Agenda|calendar\.google\.com/);
  assert.equal(message.attachments, undefined);
});

test("blank or unknown student classification fails closed for teacher calendar", async () => {
  for (const classType of [null, "", "EXPERIMENTAL", "QUINTETO"]) {
    const fixture = createNotificationFixture({ classType });
    const response = await fixture.request();
    assert.equal(response.status, 200);
    assert.equal(fixture.sent.length, 1);
    assert.doesNotMatch(fixture.sent[0].message.html, /calendar\.google\.com|Adicionar ao Google Agenda/);
    assert.equal(fixture.sent[0].message.attachments, undefined);
  }
});

test("case and surrounding whitespace do not prevent individual calendar action", async () => {
  const fixture = createNotificationFixture({ classType: "  individual " });
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.match(fixture.sent[0].message.html, /Adicionar ao Google Agenda/);
});

test("teacher individual cancellation requires manual removal only when event was saved", async () => {
  const fixture = createNotificationFixture({
    classType: "INDIVIDUAL",
    notificationType: "teacher_cancellation",
    bookingStatus: "cancelled",
  });
  assert.equal((await fixture.request()).status, 200);
  assert.match(fixture.sent[0].message.text, /remova-o manualmente/);
  assert.equal(fixture.sent[0].message.attachments, undefined);
  assert.doesNotMatch(fixture.sent[0].message.html, /calendar\.google\.com/);
});

test("teacher quinteto cancellation does not presume an event in teacher's agenda", async () => {
  const fixture = createNotificationFixture({
    classType: "QUINTETO",
    notificationType: "teacher_cancellation",
    bookingStatus: "cancelled",
  });
  assert.equal((await fixture.request()).status, 200);
  const { message } = fixture.sent[0];
  assert.match(message.text, /A vaga da reposição foi liberada/);
  assert.doesNotMatch(message.text + message.html, /Google Agenda|na sua agenda/);
  assert.equal(message.attachments, undefined);
});

test("student confirmation retains own Google Agenda link and consistent UTF-8 ICS", async () => {
  const fixture = createNotificationFixture({
    classType: "QUINTETO",
    notificationType: "booking_confirmation",
  });
  assert.equal((await fixture.request()).status, 200);
  const { message } = fixture.sent[0];
  assert.deepEqual(message.to, ["aluno@example.test"]);
  assert.match(message.text, /Adicionar ao Google Agenda/);
  assert.equal(message.attachments.length, 1);
  assert.equal(message.attachments[0].filename, "reposicao-aula.ics");
  const raw = Buffer.from(message.attachments[0].content, "base64").toString("utf8");
  assert.match(raw, /BEGIN:VCALENDAR\r\n/);
  assert.match(raw, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(raw, /END:VCALENDAR\r\n/);
  assert.doesNotMatch(raw, /Aluno de Teste/);
});

test("student cancellation has no calendar attachment", async () => {
  const fixture = createNotificationFixture({
    notificationType: "cancellation", bookingStatus: "cancelled",
  });
  assert.equal((await fixture.request()).status, 200);
  const { message } = fixture.sent[0];
  assert.deepEqual(message.to, ["aluno@example.test"]);
  assert.equal(message.attachments, undefined);
});

test("invalid authorization and malformed webhook do not emit emails", async () => {
  const fixture = createNotificationFixture();
  const unauthorized = await fixture.request(undefined, { secret: "invalid" });
  assert.equal(unauthorized.status, 401);
  const malformed = await fixture.request(undefined, {
    payload: { type: "UPDATE", schema: "public", table: "makeup_class_email_notifications" },
  });
  assert.equal(malformed.status, 400);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.notification.attempts, 0);
});

test("unknown profile safely prevents teacher notice rather than guessing type", async () => {
  const fixture = createNotificationFixture({ noProfile: true });
  const response = await fixture.request();
  assert.equal(response.status, 500);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.notification.status, "failed");
});

test("duplicate and concurrent webhooks never emit a second teacher email", async () => {
  const fixture = createNotificationFixture();
  const results = await Promise.all([fixture.request(), fixture.request()]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.notification.attempts, 1);
  assert.equal((await fixture.request()).status, 200);
  assert.equal(fixture.sent.length, 1);
});

test("provider failure is recorded and retry reuses same key and text", async () => {
  const fixture = createNotificationFixture({ providerFailures: 1 });
  assert.equal((await fixture.request()).status, 502);
  assert.equal(fixture.notification.status, "failed");
  assert.equal(fixture.notification.attempts, 1);
  assert.equal((await fixture.request()).status, 200);
  assert.equal(fixture.notification.status, "sent");
  assert.equal(fixture.notification.attempts, 2);
  assert.equal(fixture.sent.length, 2);
  assert.equal(fixture.sent[0].key, fixture.sent[1].key);
  assert.deepEqual(fixture.sent[0].message, fixture.sent[1].message);
});

test("uncertain retries beyond eighteen hours require manual reconciliation", async () => {
  const stale = new Date(Date.now() - 19 * 3600 * 1000).toISOString();
  const fixture = createNotificationFixture({ createdAt: stale });
  fixture.notification.status = "failed";
  fixture.notification.attempts = 1;
  const response = await fixture.request();
  assert.equal(response.status, 409);
  assert.equal(fixture.sent.length, 0);
  assert.equal(fixture.notification.attempts, 1);
});


test("individual Google Agenda link is a manual, timezone-safe event template", async () => {
  const fixture = createNotificationFixture({ classType: "INDIVIDUAL" });
  assert.equal((await fixture.request()).status, 200);
  assert.equal(fixture.sent.length, 1);

  const { message } = fixture.sent[0];
  const match = message.text.match(
    /Adicionar ao Google Agenda: (https:\/\/calendar\.google\.com\/calendar\/r\/eventedit\S+)/,
  );
  assert.ok(match, "Teacher must receive the event creation URL in the plain-text notice");

  const url = new URL(match[1]);
  assert.equal(url.origin, "https://calendar.google.com");
  assert.equal(url.pathname, "/calendar/r/eventedit");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("stz"), "America/Sao_Paulo");
  assert.equal(url.searchParams.get("etz"), "America/Sao_Paulo");

  const formatInstant = (value) => new Date(value).toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  assert.equal(
    url.searchParams.get("dates"),
    [formatInstant(fixture.slot.starts_at), formatInstant(fixture.slot.ends_at)].join("/"),
  );
  assert.match(url.searchParams.get("text"), /Aluno de Teste/);
  assert.match(url.searchParams.get("details"), /Turma: Turma de teste/);
  assert.equal(url.searchParams.get("location"), fixture.booking.meeting_url);

  // No invitation is sent and the link contains no mutation credentials.
  assert.equal(url.searchParams.has("add"), false);
  assert.equal(url.searchParams.has("guest"), false);
  assert.equal(url.searchParams.has("token"), false);
  assert.equal(message.attachments, undefined);
  assert.match(message.text, /após você confirmar o salvamento/);
});

test("quinteto professor receives no calendar URL or invitation fields", async () => {
  const fixture = createNotificationFixture({ classType: "QUINTETO" });
  assert.equal((await fixture.request()).status, 200);
  const { message } = fixture.sent[0];
  assert.doesNotMatch(message.html + message.text, /calendar\.google\.com|BEGIN:VCALENDAR|action=TEMPLATE/);
  assert.equal(message.attachments, undefined);
});

test("student calendar template does not include the student's name in event title", async () => {
  const fixture = createNotificationFixture({
    classType: "INDIVIDUAL",
    notificationType: "booking_confirmation",
  });
  assert.equal((await fixture.request()).status, 200);
  const { message } = fixture.sent[0];
  const match = message.text.match(
    /Adicionar ao Google Agenda: (https:\/\/calendar\.google\.com\/calendar\/r\/eventedit\S+)/,
  );
  assert.ok(match);
  const url = new URL(match[1]);
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.doesNotMatch(url.searchParams.get("text"), /Aluno de Teste/);
  assert.equal(url.searchParams.get("stz"), "America/Sao_Paulo");
  assert.equal(message.attachments.length, 1, "The student's own ICS remains available");
});
