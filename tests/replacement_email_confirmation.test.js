"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const APP_PATH = path.join(ROOT, "area-do-estudante/minhas-aulas/app.js");
const HTML_PATH = path.join(ROOT, "area-do-estudante/minhas-aulas/index.html");
const SQL_PATH = path.join(
  ROOT,
  "supabase/migrations/20261111011941_student_replacement_email_confirmation_status.sql"
);

function createElement() {
  return {
    hidden: true,
    textContent: "",
    dataset: {},
    classList: { add() {}, remove() {} },
    focus() { this.focused = true; },
    addEventListener() {},
    querySelectorAll() { return []; }
  };
}

function createFixture(options = {}) {
  const elements = new Map();
  [
    "replacementConfirmationModal",
    "replacementConfirmationClose",
    "replacementConfirmationDone",
    "replacementConfirmationEmail",
    "replacementConfirmationMessage",
    "pageMessage",
    "myClassesContent"
  ].forEach(function (id) {
    elements.set(id, createElement());
  });

  const calls = [];
  let activeElement;
  const document = {
    body: { classList: { add() {}, remove() {} } },
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll() { return []; },
    querySelector() { return createElement(); },
    contains() { return false; },
    get activeElement() { return activeElement; }
  };
  elements.forEach(function (element) {
    element.focus = function () { activeElement = element; };
  });

  const client = {
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === "book_my_lesson_replacement") {
        if (options.bookingError) return { data: null, error: { message: "Agendamento recusado" } };
        return { data: { ok: true, booking_id: options.bookingId === undefined ? "booking-123" : options.bookingId }, error: null };
      }
      if (name === "get_my_replacement_booking_email_status") {
        if (options.emailError) return { data: null, error: { message: "Consulta indisponível" } };
        return {
          data: {
            recipient_email: "aluna.cadastrada@example.com",
            status: options.status || "sent"
          },
          error: null
        };
      }
      if (name === "get_my_flexible_lessons") {
        return { data: { bookings: [], options: [] }, error: null };
      }
      return { data: null, error: null };
    }
  };

  const Auth = { getClient() { return client; } };
  const context = {
    Auth,
    document,
    console: { warn() {} },
    window: {
      confirm() { return options.confirm !== false; },
      setTimeout(callback) { callback(); }
    }
  };

  const appSource = fs.readFileSync(APP_PATH, "utf8");
  const sourceWithoutBoot = appSource.replace(
    /\n  initialize\(\);\s*\}\)\(\);\s*$/,
    "\n  globalThis.__testHooks = { bookReplacement, closeReplacementConfirmation };\n})();"
  );
  assert.notEqual(sourceWithoutBoot, appSource, "Expected to replace the page initializer");
  vm.runInNewContext(sourceWithoutBoot, context, { filename: APP_PATH });

  const bookingButton = createElement();
  bookingButton.textContent = "MARCAR REPOSIÇÃO";
  bookingButton.dataset = {
    creditId: "credit-123",
    classNumber: "20",
    startsAt: "2026-11-20T12:00:00Z"
  };

  return {
    hooks: context.__testHooks,
    calls,
    bookingButton,
    modal: elements.get("replacementConfirmationModal"),
    message: elements.get("replacementConfirmationMessage"),
    email: elements.get("replacementConfirmationEmail"),
    pageMessage: elements.get("pageMessage")
  };
}

test("opens a popup with the booking email only after confirmed provider submission", async () => {
  const fixture = createFixture({ status: "sent" });
  await fixture.hooks.bookReplacement(fixture.bookingButton);

  assert.equal(fixture.modal.hidden, false);
  assert.equal(fixture.email.textContent, "aluna.cadastrada@example.com");
  assert.match(fixture.message.textContent, /foi enviado para o e-mail/);
  assert.deepEqual(
    fixture.calls.filter((call) => call.name === "get_my_replacement_booking_email_status")
      .map((call) => call.params.target_booking_id),
    ["booking-123"]
  );
});

test("never claims the message was sent while the provider status remains pending", async () => {
  const fixture = createFixture({ status: "pending" });
  await fixture.hooks.bookReplacement(fixture.bookingButton);
  await new Promise(setImmediate);

  assert.equal(fixture.email.textContent, "aluna.cadastrada@example.com");
  assert.match(fixture.message.textContent, /ainda está sendo processado/);
  assert.doesNotMatch(fixture.message.textContent, /foi enviado/);
  assert.equal(
    fixture.calls.filter((call) => call.name === "get_my_replacement_booking_email_status").length,
    7
  );
});

test("shows a useful fallback on failed delivery status", async () => {
  const fixture = createFixture({ status: "failed" });
  await fixture.hooks.bookReplacement(fixture.bookingButton);

  assert.match(fixture.message.textContent, /envio do e-mail falhou/);
  assert.match(fixture.message.textContent, /Minhas Aulas/);
});

test("a notification status lookup error does not undo a successful booking", async () => {
  const fixture = createFixture({ emailError: true });
  await fixture.hooks.bookReplacement(fixture.bookingButton);

  assert.equal(fixture.modal.hidden, false);
  assert.match(fixture.message.textContent, /Não foi possível verificar/);
  assert.match(fixture.pageMessage.textContent, /Reposição marcada com sucesso/);
});

test("a booking failure does not display a confirmation popup", async () => {
  const fixture = createFixture({ bookingError: true });
  await fixture.hooks.bookReplacement(fixture.bookingButton);

  assert.equal(fixture.modal.hidden, true);
  assert.match(fixture.pageMessage.textContent, /Agendamento recusado/);
});

test("the confirmation query only reveals the recipient of the authenticated student's booking", () => {
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  const html = fs.readFileSync(HTML_PATH, "utf8");

  assert.match(sql, /booking\.student_id\s*=\s*\(select auth\.uid\(\)\)/i);
  assert.match(sql, /notification\.notification_type\s*=\s*'booking_confirmation'/i);
  assert.match(sql, /booking\.booking_kind\s*=\s*'replacement'/i);
  assert.match(sql, /revoke all[\s\S]+from public, anon, authenticated/i);
  assert.match(sql, /grant execute[\s\S]+to authenticated, service_role/i);
  assert.match(html, /role="dialog"[\s\S]+aria-modal="true"/);
  assert.match(html, /id="replacementConfirmationEmail"/);
});
