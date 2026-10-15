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

test("replacement email matches canonical cancellation rule", function () {
  assert.match(makeup, /Você pode cancelar esta reposição até o início da aula/);
  assert.match(makeup, /Com pelo menos 12 \(doze\) horas de antecedência/);
  assert.match(makeup, /a vaga será liberada, mas o crédito não será devolvido/);
  assert.doesNotMatch(makeup, /cancelar esse agendamento até 12 \(doze\) horas antes/);
});

test("student notification uses the verified Auth email, not a mutable profile field", function () {
  assert.match(enrollment, /auth\.admin\.getUserById\(notification\.student_id\)/);
  assert.match(enrollment, /const studentEmail = displayValue\(authUserData\?\.user\?\.email, ""\)/);
  assert.doesNotMatch(enrollment, /\.select\("id, name, email, whatsapp, enrolled"\)/);
});

test("separate email idempotency keys preserve the existing admin key on retries", function () {
  assert.match(enrollment, /idempotencyKey: `enrollment-student-\$\{notification\.id\}`/);
  assert.match(enrollment, /idempotencyKey: `enrollment-\$\{notification\.id\}`/);
  assert.match(enrollment, /"Idempotency-Key": message\.idempotencyKey/);
  assert.match(enrollment, /const \[studentEmailResponse, adminEmailResponse\] = await Promise\.all\(/);
});

test("email webhooks require their private shared secret", function () {
  for (const source of [enrollment, makeup]) {
    assert.match(source, /request\.headers\.get\("x-webhook-secret"\)/);
    assert.match(source, /await secretsMatch\(receivedWebhookSecret, expectedWebhookSecret\)/);
    assert.match(source, /return jsonResponse\(\{ error: "Unauthorized" \}, 401\)/);
  }
});

test("both email flows remain transaction-only and avoid public user metadata", function () {
  assert.doesNotMatch(enrollment, /raw_user_meta_data|user_metadata/);
  assert.doesNotMatch(makeup, /Deno\.env\.get\("ENROLLMENT_FROM_EMAIL"\)/);
  assert.match(makeup, /Idempotency-Key": `makeup-\$\{notificationType\}-\$\{notification\.id\}`/);
});

test("both administrative notification streams target the approved mailbox", function () {
  assert.match(enrollment, /const notificationEmail = "flaviofreitas@ufu\.br"/);
  assert.match(makeup, /const teacherEmail = "flaviofreitas@ufu\.br"/);
  assert.match(enrollment, /WhatsApp: \$\{studentWhatsapp\}/);
  assert.match(enrollment, /to: studentEmail/);
});
