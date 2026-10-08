const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const guide = fs.readFileSync(path.join(__dirname, "..", "guia-do-estudante.html"), "utf8");

test("omits the retired roadmap introduction, links, and embedded video", function () {
  assert.doesNotMatch(guide, /Roteiro de <span>Estudos<\/span>/);
  assert.doesNotMatch(guide, /Acesso ao material/);
  assert.doesNotMatch(guide, /youtube\.com\/embed\/tMLpyrEu6h4/);
  assert.doesNotMatch(guide, /video-embed/);
  assert.doesNotMatch(guide, /Toda aula você poderá se preparar para uma lição diferente/);
});

test("keeps the guide's explore link anchored to the first remaining section", function () {
  assert.match(guide, /class="scroll-cta" href="#section1"/);
  assert.equal((guide.match(/id="section1"/g) || []).length, 1);
  assert.match(guide, /<!-- 1 — AULAS & EXERCÍCIOS -->\s*<div class="divider" id="section1"><\/div>/);
  assert.match(guide, /Aulas & Exercícios de <span>Gramática<\/span>/);
  assert.match(guide, /Tarefas para <span>Casa<\/span>/);
});
