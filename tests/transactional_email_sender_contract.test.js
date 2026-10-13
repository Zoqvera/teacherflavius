const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const enrollment = fs.readFileSync(
  path.join(root, "supabase/functions/notify-new-enrollment/index.ts"),
  "utf8"
);
const makeup = fs.readFileSync(
  path.join(root, "supabase/functions/notify-makeup-booking/index.ts"),
  "utf8"
);

test("enrollment sends the student confirmation from the enrollment mailbox", () => {
  assert.match(
    enrollment,
    /const ENROLLMENT_FROM_EMAIL = "Matrículas <matriculas@teacherflavius\.com>";/
  );
  assert.match(enrollment, /to: \[studentEmail\]/);
  assert.match(enrollment, /subject: "Matrícula confirmada — Teacher Flávio"/);
  assert.match(enrollment, /Idempotency-Key": `enrollment-student-\$\{notification\.id\}`/);
});

test("enrollment keeps the administrative notification with an independent idempotency key", () => {
  assert.match(enrollment, /to: \[notificationEmail\]/);
  assert.match(enrollment, /Idempotency-Key": `enrollment-admin-\$\{notification\.id\}`/);
});

test("makeup notifications use the contact mailbox", () => {
  assert.match(
    makeup,
    /const MAKEUP_FROM_EMAIL = "Contato <contato@teacherflavius\.com>";/
  );
  assert.match(makeup, /from: MAKEUP_FROM_EMAIL/);
  assert.doesNotMatch(makeup, /Deno\.env\.get\("ENROLLMENT_FROM_EMAIL"\)/);
});
