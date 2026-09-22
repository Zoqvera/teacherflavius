const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260922204123_add_quintet_classification.sql"),
  "utf8"
);
const studentTypes = fs.readFileSync(path.join(root, "tipo_turma_alunos.js"), "utf8");
const classes = fs.readFileSync(path.join(root, "turmas.js"), "utf8");
const classesPage = fs.readFileSync(path.join(root, "turmas.html"), "utf8");
const classVisual = fs.readFileSync(path.join(root, "turmas/turmas_visual.js"), "utf8");
const boardVisual = fs.readFileSync(path.join(root, "quadro-de-turmas/quadro_visual.js"), "utf8");
const badgeRenderer = fs.readFileSync(path.join(root, "class_type_badge_renderer.js"), "utf8");

test("adds quintet as a valid student and class classification", function () {
  assert.match(migration, /'INDIVIDUAL', 'QUARTETO', 'QUINTETO', '8 ALUNOS'/);
  assert.match(migration, /'individual', 'quartet', 'quintet', 'eight_students'/);
  assert.match(migration, /when tc\.class_type = 'quintet' then 5/);
  assert.match(migration, /when ''QUINTETO'' then ''quintet''/);
});

test("exposes quintet in teacher classification controls", function () {
  assert.match(studentTypes, /"INDIVIDUAL", "QUARTETO", "QUINTETO", "8 ALUNOS"/);
  assert.match(classes, /label:"QUINTETO", css:"quintet"/);
  assert.match(classesPage, /option value="quintet">QUINTETO<\/option>/);
});

test("renders quintet with a five-student capacity", function () {
  assert.match(classVisual, /classList\.contains\("quintet"\)\) return 5/);
  assert.match(boardVisual, /classList\.contains\('quintet'\)\) return 5/);
  assert.match(badgeRenderer, /label: "QUINTETO"/);
});
