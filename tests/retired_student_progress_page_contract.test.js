const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const studentArea = fs.readFileSync(path.join(ROOT, "area_do_estudante.html"), "utf8");
const cleanRoutes = fs.readFileSync(path.join(ROOT, "clean_route_loader.js"), "utf8");
const cleanUrls = fs.readFileSync(path.join(ROOT, "clean_urls.js"), "utf8");
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");

test("Meu Progresso is retired from the student area and routing", function () {
  assert.doesNotMatch(studentArea, /href="\/meu-progresso\//);
  assert.doesNotMatch(studentArea, />MEU PROGRESSO<\/span>/);
  assert.doesNotMatch(cleanRoutes, /"\/meu-progresso\/"/);
  assert.doesNotMatch(cleanUrls, /"\/meu_progresso\.html"/);
});

test("Meu Progresso page assets are removed", function () {
  assert.equal(fs.existsSync(path.join(ROOT, "meu_progresso.html")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "meu-progresso", "index.html")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "meu-progresso", "meu_progresso_visual.css")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "meu-progresso", "meu_progresso_visual.js")), false);
});

test("retired progress URLs are crawlable so their missing status can be discovered", function () {
  assert.doesNotMatch(robots, /Disallow:\s*\/meu-progresso\//);
  assert.doesNotMatch(robots, /Disallow:\s*\/meu_progresso\.html/);
});
