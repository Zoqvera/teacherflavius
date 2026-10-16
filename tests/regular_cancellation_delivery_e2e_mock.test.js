"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { stripTypeScriptTypes } = require("node:module");
const { webcrypto } = require("node:crypto");

const notifierPath = path.resolve(
  __dirname, "..", "supabase/functions/notify-regular-lesson-cancellation/index.ts",
);
const WEBHOOK_SECRET = "regular-cancellation-test-secret";
const STUDENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOTIFICATION_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function makeFixture(options = {}) {
  const notice = {
    id: NOTIFICATION_ID,
    student_id: STUDENT_ID,
    student_name: options.studentName || "Aluno Fictício",
    class_name: "Turma fictícia",
    starts_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 25 * 3600 * 1000).toISOString(),
    credit_granted: options.creditGranted ?? true,
    recipient_type: options.recipientType || "student",
    status: options.status || "pending",
    attempts: options.attempts || 0,
    created_at: options.createdAt || new Date().toISOString(),
  };
  const environment = {
    SUPABASE_URL: "https://example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "nonproduction-fixture-key",
    RESEND_API_KEY: "nonproduction-fixture-resend-key",
    ENROLLMENT_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };

  class Query {
    constructor() {
      this.conditions = [];
      this.patch = null;
    }

    select() { return this; }

    update(patch) {
      this.patch = patch;
      return this;
    }

    eq(column, value) {
      this.conditions.push([column, value]);
      return this;
    }

    matched() {
      return this.conditions.every(([column, value]) => notice[column] === value);
    }

    execute() {
      if (!this.matched()) return { data: null, error: null };
      if (this.patch) Object.assign(notice, this.patch);
      return { data: { ...notice }, error: null };
    }

    single() {
      const result = this.execute();
      return Promise.resolve(result.data ? result : {
        data: null, error: { message: "Missing notification" },
      });
    }

    maybeSingle() {
      return Promise.resolve(this.execute());
    }

    then(resolve, reject) {
      return Promise.resolve(this.execute()).then(resolve, reject);
    }
  }

  const recordedRequests = [];
  let remainingFailures = options.failures || 0;
  const supabase = {
    from: (table) => {
      assert.equal(table, "regular_lesson_cancellation_email_notifications");
      return new Query();
    },
    auth: {
      admin: {
        getUserById: async (id) => {
          assert.equal(id, STUDENT_ID);
          return options.missingUser
            ? { data: { user: null }, error: { message: "Missing fixture user" } }
            : { data: { user: { email: "aluno@example.test" } }, error: null };
        },
      },
    },
  };
  let handler;
  const fakeFetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    recordedRequests.push({
      message: JSON.parse(init.body),
      key: init.headers["Idempotency-Key"],
    });
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      return new Response("Simulated 502", { status: 502 });
    }
    return new Response(JSON.stringify({ id: "fixture-resend-accepted" }), { status: 200 });
  };

  const typescript = fs.readFileSync(notifierPath, "utf8");
  const source = typescript.replace(
    /^import \{ createClient \} from "https:\/\/esm\.sh\/@supabase\/supabase-js@[^"]+";\r?\n/,
    "",
  );
  assert.notEqual(source, typescript, "Expected pinned Supabase SDK import");
  vm.runInNewContext(stripTypeScriptTypes(source), {
    Deno: {
      env: { get: (key) => environment[key] || null },
      serve: (callback) => { handler = callback; },
    },
    createClient: () => supabase,
    fetch: fakeFetch,
    crypto: webcrypto,
    TextEncoder,
    Request,
    Response,
    Date,
    Intl,
    console: { error() {}, log() {}, warn() {} },
  }, { filename: "notify-regular-lesson-cancellation.ts (isolated)", timeout: 3000 });
  assert.equal(typeof handler, "function");

  function request(overrides = {}) {
    return handler(new Request("https://example.invalid/functions/v1/notify-regular-lesson-cancellation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-webhook-secret": overrides.secret ?? WEBHOOK_SECRET,
      },
      body: JSON.stringify(overrides.payload ?? {
        type: "INSERT",
        schema: "public",
        table: "regular_lesson_cancellation_email_notifications",
        record: { id: NOTIFICATION_ID },
      }),
    }));
  }

  return { notice, recordedRequests, request };
}

test("early cancellation: verified student gets a credit-confirming message", async () => {
  const fixture = makeFixture({ creditGranted: true });
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(fixture.notice.status, "sent");
  assert.equal(fixture.notice.attempts, 1);
  assert.equal(fixture.recordedRequests.length, 1);
  const { message, key } = fixture.recordedRequests[0];
  assert.deepEqual(message.to, ["aluno@example.test"]);
  assert.match(message.text, /Foi disponibilizado um crédito de reposição/);
  assert.equal(message.reply_to, "contato@teacherflavius.com");
  assert.equal(key, "regular-cancellation-student-" + NOTIFICATION_ID);
  assert.equal(message.attachments, undefined);
});

test("late cancellation: professor gets explicit no-credit message", async () => {
  const fixture = makeFixture({ creditGranted: false, recipientType: "teacher" });
  const response = await fixture.request();
  assert.equal(response.status, 200);
  assert.equal(fixture.recordedRequests.length, 1);
  const { message, key } = fixture.recordedRequests[0];
  assert.deepEqual(message.to, ["contato@teacherflavius.com"]);
  assert.match(message.text, /não foi concedido crédito de reposição/);
  assert.match(message.text, /Aluno: Aluno Fictício/);
  assert.equal(message.attachments, undefined);
  assert.doesNotMatch(message.text + message.html, /calendar\.google\.com|Adicionar ao Google Agenda/);
  assert.equal(key, "regular-cancellation-teacher-" + NOTIFICATION_ID);
});

test("Resend 502 is recorded and retried with identical idempotency key", async () => {
  const fixture = makeFixture({ failures: 1 });
  assert.equal((await fixture.request()).status, 502);
  assert.equal(fixture.notice.status, "failed");
  assert.equal(fixture.notice.attempts, 1);
  assert.match(fixture.notice.last_error, /Resend HTTP 502/);
  assert.equal((await fixture.request()).status, 200);
  assert.equal(fixture.notice.status, "sent");
  assert.equal(fixture.notice.attempts, 2);
  assert.equal(fixture.recordedRequests.length, 2);
  assert.equal(fixture.recordedRequests[0].key, fixture.recordedRequests[1].key);
  assert.deepEqual(fixture.recordedRequests[0].message.to, fixture.recordedRequests[1].message.to);
  assert.equal((await fixture.request()).status, 200);
  assert.equal(fixture.recordedRequests.length, 2, "sent notices cannot be sent again");
});

test("concurrent identical webhooks atomically claim one provider send", async () => {
  const fixture = makeFixture();
  const responses = await Promise.all([fixture.request(), fixture.request()]);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(fixture.recordedRequests.length, 1);
  assert.equal(fixture.notice.attempts, 1);
});

test("missing student Auth address fails without contacting Resend", async () => {
  const fixture = makeFixture({ missingUser: true });
  const response = await fixture.request();
  assert.equal(response.status, 422);
  assert.equal(fixture.recordedRequests.length, 0);
  assert.equal(fixture.notice.status, "failed");
});

test("rejects malformed webhooks and incorrect webhook secret", async () => {
  const fixture = makeFixture();
  assert.equal((await fixture.request({ secret: "wrong" })).status, 401);
  assert.equal((await fixture.request({ payload: { type: "UPDATE", record: { id: NOTIFICATION_ID } } })).status, 400);
  assert.equal(fixture.recordedRequests.length, 0);
  assert.equal(fixture.notice.attempts, 0);
});

test("old uncertain retry requires manual reconciliation before sending", async () => {
  const fixture = makeFixture({
    status: "failed",
    attempts: 1,
    createdAt: new Date(Date.now() - 19 * 3600 * 1000).toISOString(),
  });
  const response = await fixture.request();
  assert.equal(response.status, 409);
  assert.equal(fixture.recordedRequests.length, 0);
  assert.equal(fixture.notice.attempts, 1);
});

test("untrusted student names are HTML escaped in email body", async () => {
  const fixture = makeFixture({ studentName: "<script>alert(1)</script>" });
  assert.equal((await fixture.request()).status, 200);
  const body = fixture.recordedRequests[0].message.html;
  assert.doesNotMatch(body, /<script>/);
  assert.match(body, /&lt;script&gt;/);
});
