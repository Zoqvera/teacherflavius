const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "area_do_estudante.html"), "utf8");
const script = fs.readFileSync(path.join(root, "area_do_estudante.js"), "utf8");

test("student area no longer asks for availability after enrollment", function () {
  assert.doesNotMatch(page, /profileSetupPrompt/);
  assert.doesNotMatch(page, /Informe sua disponibilidade quando puder/);
  assert.doesNotMatch(page, /INFORMAR HORÁRIOS/);
  assert.doesNotMatch(page, /\/perfil\/#disponibilidade/);
  assert.doesNotMatch(page, /profile_completion_prompt\.css/);
});

test("student dashboard no longer evaluates availability for a prompt", function () {
  assert.doesNotMatch(script, /countAvailabilitySlots/);
  assert.doesNotMatch(script, /updateProfileSetupPrompt/);
  assert.doesNotMatch(script, /hideProfileSetupPrompt/);
  assert.doesNotMatch(script, /profileSetupPrompt/);
});

test("student dashboard hides legacy study and replacement cards", function () {
  assert.doesNotMatch(page, /href="\\/roteiro-de-estudos\\/"/);
  assert.doesNotMatch(page, />ROTEIRO DE ESTUDOS</);
  assert.doesNotMatch(page, /href="\\/conversation-questions\\/"/);
  assert.doesNotMatch(page, />CONVERSATION QUESTIONS</);
  assert.doesNotMatch(page, /href="\\/reposicoes\\/"/);
  assert.doesNotMatch(page, />REPOSIÇÕES</);
});
