const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("retired Alunos do dia has no published page or client assets", () => {
  for (const file of [
    "alunos-do-dia/index.html",
    "alunos-do-dia/alunos_do_dia.css",
    "alunos-do-dia/alunos_do_dia.js",
    "alunos-do-dia/whatsapp_contact.js"
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});

test("professor navigation permanently excludes the retired card", () => {
  const home = read("professor_home.js");
  const icons = read("professor/professor_icons.js");
  const readme = read("README.md");

  assert.match(home, /RETIRED_PROFESSOR_CARD_IDS[\s\S]*?"alunos-do-dia"[\s\S]*?\]\)/);
  assert.doesNotMatch(home, /id:\s*"alunos-do-dia"/);
  assert.doesNotMatch(home, /href:\s*"\/alunos-do-dia\/"/);
  assert.doesNotMatch(icons, /'alunos-do-dia':/);
  assert.doesNotMatch(readme, /\| \`\/alunos-do-dia\/\` \|/);
});

test("build scripts do not depend on the retired assets", () => {
  const packageConfig = read("package.json");
  const lintConfig = read("eslint.config.js");
  assert.doesNotMatch(packageConfig, /alunos-do-dia\//);
  assert.doesNotMatch(lintConfig, /alunos-do-dia\//);
});
