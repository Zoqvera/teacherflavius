const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const notifier = fs.readFileSync(
  path.join(root, "supabase/functions/notify-new-enrollment/index.ts"),
  "utf8"
);
const privacyMap = fs.readFileSync(path.join(root, "LGPD_DATA_MAP.md"), "utf8");

test("new enrollment email includes student name and WhatsApp", function () {
  assert.match(notifier, /select\("id, name, whatsapp, enrolled"\)/);
  assert.match(notifier, /`Nome: \$\{studentName\}`/);
  assert.match(notifier, /`WhatsApp: \$\{studentWhatsapp\}`/);
  assert.match(notifier, /<strong>Nome:<\/strong> \$\{studentNameHtml\}/);
  assert.match(notifier, /<strong>WhatsApp:<\/strong> \$\{studentWhatsappHtml\}/);
});

test("enrollment email escapes contact values before HTML interpolation", function () {
  assert.match(notifier, /function escapeHtml\(value: string\)/);
  assert.match(notifier, /const studentNameHtml = escapeHtml\(studentName\)/);
  assert.match(notifier, /const studentWhatsappHtml = escapeHtml\(studentWhatsapp\)/);
});

test("privacy inventory reflects the enrollment email data flow", function () {
  assert.match(privacyMap, /notificação administrativa de nova matrícula inclui o nome e o WhatsApp do aluno/);
  assert.match(privacyMap, /CPF, e-mail, código de matrícula e chave PIX continuam fora da mensagem/);
});
