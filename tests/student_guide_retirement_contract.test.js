const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("deletes both student guide entrypoints", function () {
  assert.equal(fs.existsSync(path.join(root, "guia-do-estudante.html")), false);
  assert.equal(fs.existsSync(path.join(root, "guia-do-estudante/index.html")), false);
});

test("removes the student guide card and obsolete route aliases", function () {
  const studentArea = read("area_do_estudante.html");
  assert.equal(studentArea.includes('id="guiaDoEstudanteLink"'), false);
  assert.equal(studentArea.includes('href="/guia-do-estudante/"'), false);
  assert.match(studentArea, /Ajuda e informações/);
  assert.match(studentArea, /Avaliar minhas aulas/);
  assert.match(studentArea, /Ler o livro/);

  assert.equal(read("clean_route_loader.js").includes("guia-do-estudante"), false);
  assert.equal(read("clean_urls.js").includes("guia-do-estudante"), false);
});

test("clears documentation and permits crawlers to observe the 404 response", function () {
  assert.equal(read("README.md").includes("/guia-do-estudante.html"), false);
  assert.equal(read("robots.txt").includes("Disallow: /guia-do-estudante"), false);
  assert.equal(read("sitemap.xml").includes("guia-do-estudante"), false);
});
