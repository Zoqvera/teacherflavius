const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const enrollment = read("supabase/functions/notify-new-enrollment/index.ts");
const makeup = read("supabase/functions/notify-makeup-booking/index.ts");

test("enrollment and replacement use dedicated sender addresses", function () {
  assert.match(enrollment, /Matrículas <matriculas@teacherflavius\.com>/);
  assert.doesNotMatch(enrollment, /Deno\.env\.get\("ENROLLMENT_FROM_EMAIL"\)/);

  assert.match(makeup, /Teacher Flávio <contato@teacherflavius\.com>/);
  assert.doesNotMatch(makeup, /Deno\.env\.get\("ENROLLMENT_FROM_EMAIL"\)/);
  assert.match(makeup, /from: MAKEUP_FROM_EMAIL/);
});

test("enrollment sends both student confirmation and existing administrative notice", function () {
  assert.match(enrollment, /auth\.admin\.getUserById\(notification\.student_id\)/);
  assert.match(enrollment, /to: studentEmail/);
  assert.match(enrollment, /subject: "Matrícula confirmada — Teacher Flávio"/);
  assert.match(enrollment, /idempotencyKey: `enrollment-student-\$\{notification\.id\}`/);
  assert.match(enrollment, /to: notificationEmail/);
  assert.match(enrollment, /idempotencyKey: `enrollment-\$\{notification\.id\}`/);
});

test("replacement keeps the current cancellation policy text", function () {
  assert.match(makeup, /Você pode cancelar esse agendamento até 12 \(doze\) horas antes do horário da aula/);
});
