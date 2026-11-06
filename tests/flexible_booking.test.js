const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "..");

test("FLEXIVEL email includes the three resource links, definitive policy and dedicated sender", async () => {
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
  assert.match(email.text, /não permite cancelamento/);
  assert.match(email.text, /ausência consome o crédito/);
  assert.doesNotMatch(email.html, /<script>/);
  assert.throws(() => flexibleBookingEmail({ ...input, materialUrl: "javascript:alert(1)" }));
});

test("FLEXIVEL page displays vacancies and confirmed resources without cancellation or replacement actions", async () => {
  const content = { innerHTML: "", querySelectorAll: () => [] };
  const elements = { myClassesContent: content, loginStatus: {}, pageMessage: {} };
  const state = { booking_mode: "FLEXIVEL", options: [{ class_number: 7,
    class_name: "Turma <7>", starts_at: "2026-11-09T21:00:00Z", available_spots: 1, can_book: true }],
  bookings: [{ class_name: "Turma 1", starts_at: "2026-11-06T21:00:00Z",
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
  assert.doesNotMatch(content.innerHTML, /regular-cancel-button|replacement-book-button|enrollment-cancel-button/);
});
