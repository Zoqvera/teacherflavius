const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const read = (path) => readFileSync(join(root, path), "utf8");

test("weekly email is disabled unless teacher deliberately opts in", () => {
  const html = read("matricula-semanal/index.html");
  const script = read("matricula-semanal/app.js");
  assert.match(html, /name="contact_email"[^>]*disabled/);
  assert.match(html, /name="enable_contact_email" type="checkbox"/);
  assert.match(html, /autocomplete="off"/);
  assert.match(script, /emailField\.disabled = true/);
  assert.match(script, /useEmail\.checked = false/);
  assert.match(script, /emailField\.disabled = !useEmail\.checked/);
  assert.match(script, /if \(!useEmail\.checked\) emailField\.value = ""/);
});

test("weekly registration detects accidental use of professor email", () => {
  const script = read("matricula-semanal/app.js");
  const server = read("supabase/functions/create-administrative-student/index.ts");
  assert.match(script, /contactEmail\.toLowerCase\(\) === teacherEmail/);
  assert.match(server, /enteredEmail === loggedInEmail/);
  assert.match(server, /message === "Já existe cadastro ativo com este e-mail\."/);
  assert.match(server, /error && typeof error === "object" && "message" in error/);
});

test("email fixes preserve individual class dates, unique weekly tuition, and noindex", () => {
  const html = read("matricula-semanal/index.html");
  const script = read("matricula-semanal/app.js");
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(script, /billing_frequency: "weekly"/);
  assert.match(script, /first_lesson_date: date/);
  assert.match(script, /classes: selected/);
});
