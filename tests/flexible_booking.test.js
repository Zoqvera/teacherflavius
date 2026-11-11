const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");

test("FLEXIVEL email includes resource links, 12-hour cancellation policy and dedicated sender", async () => {
  const { flexibleBookingEmail } = await import(pathToFileURL(path.join(root,
    "supabase/functions/_shared/flexible_booking_email.mjs")));
  const input = { studentName: '<script>alert("x")</script>', className: "Turma 1",
    classDate: "segunda-feira, 09/11/2026", schedule: "18h às 19h",
    meetingUrl: "https://meet.google.com/test", materialUrl: "https://docs.google.com/test",
    recordingsUrl: "https://drive.google.com/test", calendarUrl: "https://calendar.google.com/test" };
  const email = flexibleBookingEmail(input);
  assert.equal(email.from, "Teacher Flávio <reservas@teacherflavius.com>");
  for (const url of [input.meetingUrl,input.materialUrl,input.recordingsUrl]) {
    assert.ok(email.text.includes(url));
    assert.ok(email.html.includes(url));
  }
  assert.match(email.text, /pelo menos 12 horas de antecedência/);
  assert.match(email.text, /volta ao saldo FLEXÍVEL/);
  assert.match(email.text, /faltas não devolvem crédito/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.throws(() => flexibleBookingEmail({ ...input, materialUrl: "javascript:alert(1)" }));
});

test("FLEXIVEL page displays vacancies, resources and eligible cancellation without fixed-student actions", async () => {
  const content = { innerHTML: "", querySelectorAll: () => [] };
  const elements = { myClassesContent: content, loginStatus: {}, pageMessage: {} };
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const creditDeadline = new Date(Date.parse(startsAt) - 12 * 60 * 60 * 1000).toISOString();
  const state = { booking_mode: "FLEXIVEL", options: [{ class_number: 7,
    class_name: "Turma <7>", starts_at: "2026-11-09T21:00:00Z", available_spots: 1, can_book: true }],
  bookings: [{ booking_id: "booking-id", class_name: "Turma 1", starts_at: startsAt,
    credit_deadline: creditDeadline, can_cancel: true, credit_if_cancelled: true,
    meeting_url: "https://meet.google.com/test", material_url: "https://docs.google.com/test",
    recorded_lessons_url: "https://drive.google.com/test", email_status: "failed" }] };
  const calls = [];
  const auth = { isConfigured: () => true, getSession: async () => ({ user: { id: "test" } }),
    getVerifiedSession: async () => ({ user: { id: "test" } }),
    getClient: () => ({ rpc: async name => { calls.push(name); return { data: state }; } }) };
  vm.runInNewContext(fs.readFileSync(path.join(root,"area-do-estudante/minhas-aulas/app.js"),"utf8"), {
    Auth: auth, window: { Auth: auth, SUPABASE_CONFIG: {}, setTimeout },
    document: { getElementById: id => elements[id] || null, body: { classList: { remove() {} } } }, console,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(calls, ["get_my_flexible_lessons"]);
  assert.match(content.innerHTML, /RESERVAR ESTA AULA/);
  assert.match(content.innerHTML, /Turma &lt;7&gt;/);
  assert.match(content.innerHTML, /MATERIAL DIDÁTICO/);
  assert.match(content.innerHTML, /envio.*pendente/);
  assert.match(content.innerHTML, /flexible-cancel-button/);
  assert.match(content.innerHTML, /CANCELAR RESERVA/);
  assert.match(content.innerHTML, /recuperar seu crédito de aula/);
  assert.doesNotMatch(content.innerHTML, /regular-cancel-button|replacement-book-button|enrollment-cancel-button/);
});

test("FLEXIVEL cancellation calls its owned-booking RPC and reports restored credit", async () => {
  const bookingId = "test-booking-123";
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const deadline = new Date(Date.parse(startsAt) - 12 * 60 * 60 * 1000).toISOString();
  const booking = { booking_id: bookingId, class_name: "Turma 1", starts_at: startsAt,
    credit_deadline: deadline, can_cancel: true, credit_if_cancelled: true };
  const state = { booking_mode: "FLEXIVEL", options: [], bookings: [booking] };
  const requestLog = [];
  const button = { dataset: { bookingId }, disabled: false, textContent: "CANCELAR RESERVA",
    addEventListener(_event, handler) { this.click = handler; } };
  const content = { innerHTML: "",
    querySelectorAll(selector) { return selector === ".flexible-cancel-button" ? [button] : []; } };
  const elements = { myClassesContent: content, loginStatus: {}, pageMessage: {} };
  const auth = {
    isConfigured: () => true,
    getSession: async () => ({ user: { id: "student-123" } }),
    getVerifiedSession: async () => ({ user: { id: "student-123" } }),
    getClient: () => ({ rpc: async (name, args) => {
      requestLog.push({ name, args });
      return { data: name === "cancel_my_flexible_lesson"
        ? { ok: true, credit_granted: true } : state };
    } }),
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,"area-do-estudante/minhas-aulas/app.js"),"utf8"), {
    Auth: auth,
    window: { Auth: auth, SUPABASE_CONFIG: {}, setTimeout, confirm: () => true },
    document: { getElementById: id => elements[id] || null,
      body: { classList: { remove() {} } } }, console,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(typeof button.click, "function");
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(requestLog[1].name, "cancel_my_flexible_lesson");
  assert.equal(requestLog[1].args.target_booking_id, bookingId);
  assert.match(elements.pageMessage.textContent, /crédito voltou ao seu saldo FLEXÍVEL/);
});

test("FLEXIVEL late cancellation informs that no credit will be returned", async () => {
  const startsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const deadline = new Date(Date.parse(startsAt) - 12 * 60 * 60 * 1000).toISOString();
  const content = { innerHTML: "", querySelectorAll: () => [] };
  const auth = { isConfigured: () => true,
    getSession: async () => ({ user: { id: "student" } }),
    getVerifiedSession: async () => ({ user: { id: "student" } }),
    getClient: () => ({ rpc: async () => ({ data: {
      booking_mode: "FLEXIVEL", options: [], bookings: [{
        booking_id: "late-booking", class_name: "Turma 8", starts_at: startsAt,
        credit_deadline: deadline, can_cancel: true, credit_if_cancelled: false
      }]
    } }) })
  };
  vm.runInNewContext(fs.readFileSync(path.join(root,"area-do-estudante/minhas-aulas/app.js"),"utf8"), {
    Auth: auth, window: { Auth: auth, SUPABASE_CONFIG: {}, setTimeout },
    document: { getElementById: id => id === "myClassesContent" ? content : null,
      body: { classList: { remove() {} } } }, console,
  });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(content.innerHTML, /CANCELAR RESERVA/);
  assert.match(content.innerHTML, /sem devolução do crédito/);
});
