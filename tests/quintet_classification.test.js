const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261007012501_enforce_quintet_only_group_classification.sql"),
  "utf8"
);
const baselineOverlay = fs.readFileSync(
  path.join(root, "supabase/baseline/300_enforce_quintet_only_group_classification.sql"),
  "utf8"
);
const studentTypes = fs.readFileSync(path.join(root, "tipo_turma_alunos.js"), "utf8");
const classes = fs.readFileSync(path.join(root, "turmas.js"), "utf8");
const classesPage = fs.readFileSync(path.join(root, "turmas.html"), "utf8");
const classVisual = fs.readFileSync(path.join(root, "turmas/turmas_visual.js"), "utf8");
const boardVisual = fs.readFileSync(path.join(root, "quadro-de-turmas/quadro_visual.js"), "utf8");
const badgeRenderer = fs.readFileSync(path.join(root, "class_type_badge_renderer.js"), "utf8");

const legacyClassTypePattern = /QUARTETO|8 ALUNOS|eight_students|quartet/;

test("normalizes legacy group classifications into quintet", function () {
  assert.match(migration, /set class_type = 'QUINTETO'[\s\S]*where class_type in \('QUARTETO', '8 ALUNOS'\)/);
  assert.match(migration, /set class_type = 'quintet'[\s\S]*where class_type in \('quartet', 'eight_students'\)/);
  assert.match(migration, /capacity_override = 8/);
});

test("restricts persistent class types to individual and quintet", function () {
  assert.match(
    migration,
    /check \(class_type is null or class_type in \('INDIVIDUAL', 'QUINTETO'\)\)/
  );
  assert.match(
    migration,
    /check \(class_type is null or class_type in \('individual', 'quintet'\)\)/
  );
  assert.match(migration, /drop function if exists public\.get_public_quartet_vacancies\(\);/);
});

test("keeps disaster-recovery overlay identical to the production migration", function () {
  assert.equal(baselineOverlay, migration);
});

test("teacher controls expose only individual and quintet", function () {
  assert.match(studentTypes, /const CLASS_TYPES = \["INDIVIDUAL", "QUINTETO"\]/);
  assert.match(classes, /label:"QUINTETO", css:"quintet"/);
  assert.match(classes, /label:"INDIVIDUAL", css:"individual"/);
  assert.match(classesPage, /option value="individual">INDIVIDUAL<\/option>/);
  assert.match(classesPage, /option value="quintet">QUINTETO<\/option>/);
});

test("active client code cannot render or select legacy class types", function () {
  for (const source of [
    studentTypes,
    classes,
    classesPage,
    classVisual,
    boardVisual,
    badgeRenderer
  ]) {
    assert.doesNotMatch(source, legacyClassTypePattern);
  }
});

test("canonical visual capacity remains one for individual and eight for quintet", function () {
  assert.match(classVisual, /classList\.contains\("individual"\)\) return 1/);
  assert.match(classVisual, /classList\.contains\("quintet"\)\) return 8/);
  assert.match(boardVisual, /classList\.contains\('individual'\)\) return 1/);
  assert.match(boardVisual, /classList\.contains\('quintet'\)\) return 8/);
  assert.match(badgeRenderer, /value === "quintet"/);
  assert.match(badgeRenderer, /label: "QUINTETO"/);
});
