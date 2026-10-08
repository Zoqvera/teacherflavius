const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const studentArea = fs.readFileSync(path.join(ROOT, "area_do_estudante.html"), "utf8");
const cleanUrls = fs.readFileSync(path.join(ROOT, "clean_urls.js"), "utf8");
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");

test("student frequency route is retired from navigation", function () {
  assert.doesNotMatch(studentArea, /href="\/frequencia\//);
  assert.doesNotMatch(studentArea, />FREQUÊNCIA<\/span>/);
  assert.doesNotMatch(cleanUrls, /"\/frequencia\/"/);
});

test("student frequency entrypoints and client script are removed", function () {
  const html = "." + "html";
  assert.equal(fs.existsSync(path.join(ROOT, "frequencia", "index" + html)), false);
  assert.equal(fs.existsSync(path.join(ROOT, "frequencia_aluno" + html)), false);
  assert.equal(fs.existsSync(path.join(ROOT, "frequência" + html)), false);
  assert.equal(fs.existsSync(path.join(ROOT, "frequencia_aluno.js")), false);
});

test("retired frequency URLs are crawlable so their missing status can be discovered", function () {
  const legacy = "frequencia_aluno" + "." + "html";
  assert.doesNotMatch(robots, /Disallow:\s*\/frequencia\//);
  assert.equal(robots.includes("Disallow: /" + legacy), false);
});
