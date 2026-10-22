"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { stripTypeScriptTypes } = require("node:module");

const root = path.resolve(__dirname, "..");
const sql = fs.readFileSync(
  path.join(root, "supabase/migrations/20261022205054_add_tuition_email_reminders.sql"), "utf8",
);
const edge = fs.readFileSync(
  path.join(root, "supabase/functions/notify-tuition-email-reminders/index.ts"), "utf8",
);
const standard = {
  reminder_id: "a0000000-0000-4000-8000-000000000001",
  tuition_id: "b0000000-0000-4000-8000-000000000001",
  student_id: "c0000000-0000-4000-8000-000000000001",
  due_date: "2026-10-24",
  reminder_kind: "before_due",
};

function createFixture(options = {}) {
  const sent = [];
  const finishes = [];
  let checks = 0;
  let claims = 0;
  let handler;
  const reminders = options.reminders || [standard];
  const env = {
    SUPABASE_URL: "https://isolated.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "isolated-service",
    RESEND_API_KEY: "isolated-resend",
    ENROLLMENT_WEBHOOK_SECRET: "isolated-webhook",
  };
  const client = {
    auth: { admin: { getUserById: async () => ({
      data: { user: {
        email: options.email === undefined ? "student@example.test" : options.email,
        email_confirmed_at: options.unverified ? null : "2026-10-01T00:00:00Z",
      } }, error: null,
    }) } },
    rpc: async (name, params) => {
      if (name === "claim_tuition_email_reminders_internal") {
        claims += 1;
        return { data: reminders, error: null };
      }
      if (name === "is_tuition_email_reminder_eligible_internal") {
        checks += 1;
        return { data: options.paidAfterFirstCheck ? checks === 1 : options.eligible !== false, error: null };
      }
      if (name === "finish_tuition_email_reminder_internal") {
        finishes.push(params);
        return { data: true, error: null };
      }
      throw new Error("Unexpected RPC " + name);
    },
  };
  const source = stripTypeScriptTypes(edge.replace(
    /^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@[^"]+";\r?\n/,
    "",
  ));
  vm.runInNewContext(source, {
    Deno: { env: { get: (key) => env[key] || null }, serve: (fn) => { handler = fn; } },
    createClient: () => client,
    fetch: async (url, init) => {
      assert.equal(url, "https://api.resend.com/emails");
      const body = JSON.parse(init.body);
      sent.push({ body, headers: init.headers });
      return options.providerFailure
        ? new Response("Provider unavailable", { status: 503 })
        : new Response(JSON.stringify({ id: "isolated-accepted" }), { status: 200 });
    },
    crypto: webcrypto,
    TextEncoder,
    Request,
    Response,
    console: { error() {}, warn() {}, log() {} },
    setTimeout: (callback) => { callback(); },
  }, { filename: "notify-tuition-email-reminders.ts", timeout: 3000 });

  return {
    sent, finishes,
    get checks() { return checks; },
    get claims() { return claims; },
    request: (secret = "isolated-webhook") => handler(new Request(
      "https://isolated.invalid/functions/v1/notify-tuition-email-reminders",
      { method: "POST", headers: { "x-webhook-secret": secret } },
    )),
  };
}

test("exactly three date-scoped reminder types, no retroactive backfill", () => {
  assert.match(sql, /reminder_kind in \('before_due', 'due_today', 'after_due'\)/);
  assert.match(sql, /tuition\.due_date in \(local_day \+ 2, local_day, local_day - 2\)/);
  assert.match(sql, /unique \(tuition_id, due_date, reminder_kind\)/);
  assert.match(sql, /local_day < date '2026-10-23'/);
  assert.match(sql, /'tuition-email-enqueue-09h'/);
  assert.match(sql, /'0 12 \* \* \*'/);
  assert.match(sql, /'tuition-email-dispatch-5m'/);
  assert.match(sql, /'America\/Sao_Paulo'/);
});

test("database refuses paid, exempt, archived, inactive, changed or duplicated reminders", () => {
  assert.match(sql, /tuition\.payment_date is null/g);
  assert.match(sql, /coalesce\(tuition\.is_exempt, false\) = false/g);
  assert.match(sql, /student\.archived = false/g);
  assert.match(sql, /student\.enrolled = true/g);
  assert.match(sql, /tuition\.amount_due > 0/g);
  assert.match(sql, /notice\.due_date = tuition\.due_date/g);
  assert.match(sql, /notice\.student_id = tuition\.student_id/g);
  assert.match(sql, /for update of notice skip locked/);
  assert.match(sql, /notice\.attempts < 3/);
  assert.match(sql, /on conflict \(tuition_id, due_date, reminder_kind\) do nothing/);
});

test("service role only, secret from Vault, no public recipient data", () => {
  assert.match(sql, /create table if not exists private\.tuition_email_reminders/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on table private\.tuition_email_reminders from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.claim_tuition_email_reminders_internal\(integer\) to service_role/);
  assert.match(sql, /vault\.decrypted_secrets/);
  assert.match(edge, /auth\.admin\.getUserById/);
  assert.doesNotMatch(edge, /\.from\("profiles"\)/);
  assert.match(edge, /"Idempotency-Key": "tuition-email-" \+ reminder\.reminder_id/);
  assert.match(edge, /reply_to: "contato@teacherflavius\.com"/);
});

test("sends three distinct messages from financial sender with payment link", async () => {
  const rows = ["before_due", "due_today", "after_due"].map((kind, i) => ({
    ...standard,
    reminder_kind: kind,
    reminder_id: standard.reminder_id.slice(0, -1) + String(i + 1),
  }));
  const fixture = createFixture({ reminders: rows });
  const result = await fixture.request();
  assert.equal(result.status, 200);
  const summary = await result.json();
  assert.equal(summary.sent, 3);
  assert.equal(fixture.sent.length, 3);
  assert.equal(fixture.finishes.length, 3);
  assert.equal(fixture.checks, 6);
  for (const { body, headers } of fixture.sent) {
    assert.equal(body.from, "Financeiro Teacher Flávio <financeiro@teacherflavius.com>");
    assert.equal(body.reply_to, "contato@teacherflavius.com");
    assert.deepEqual(body.to, ["student@example.test"]);
    assert.match(body.text, /https:\/\/teacherflavius\.com\/pagamento\//);
    assert.match(body.html, /https:\/\/teacherflavius\.com\/pagamento\//);
    assert.match(headers["Idempotency-Key"], /^tuition-email-/);
  }
  assert.match(fixture.sent[0].body.subject, /vence em 2 dias/);
  assert.match(fixture.sent[1].body.subject, /vence hoje/);
  assert.match(fixture.sent[2].body.subject, /vencida há 2 dias/);
});

test("unauthorized requests never claim or send", async () => {
  const fixture = createFixture();
  assert.equal((await fixture.request("wrong-secret")).status, 401);
  assert.equal(fixture.claims, 0);
  assert.equal(fixture.sent.length, 0);
});

test("paid or archived after queue creation skips without sending", async () => {
  for (const options of [{ eligible: false }, { paidAfterFirstCheck: true }]) {
    const fixture = createFixture(options);
    const result = await fixture.request();
    assert.equal(result.status, 200);
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.finishes[0].target_outcome, "skipped");
  }
});

test("unverified or absent Auth email fails safely", async () => {
  for (const options of [{ unverified: true }, { email: "" }]) {
    const fixture = createFixture(options);
    assert.equal((await fixture.request()).status, 200);
    assert.equal(fixture.sent.length, 0);
    assert.equal(fixture.finishes[0].target_outcome, "failed");
  }
});

test("provider rejection records a retryable failure", async () => {
  const fixture = createFixture({ providerFailure: true });
  const result = await fixture.request();
  assert.equal(result.status, 200);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.finishes[0].target_outcome, "failed");
  assert.match(fixture.finishes[0].target_error, /provider_http_503/);
});
