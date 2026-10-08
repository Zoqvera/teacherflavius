const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("removes both student guide entrypoints from the published source", function () {
  assert.equal(fs.existsSync(path.join(root, "guia-do-estudante.html")), false);
  assert.equal(fs.existsSync(path.join(root, "guia-do-estudante/index.html")), false);
});

test("removes the student guide card and both former route aliases", function () {
  const studentArea = read("area_do_estudante.html");
  assert.doesNotMatch(studentArea, /guiaDoEstudanteLink|href="\\/guia-do-estudante\\/"/);
  assert.match(studentArea, /Ajuda e informações/);
  assert.match(studentArea, /Avaliar minhas aulas/);
  assert.match(studentArea, /Ler o livro/);

  assert.doesNotMatch(read("clean_route_loader.js"), /guia-do-estudante/);
  assert.doesNotMatch(read("clean_urls.js"), /guia-do-estudante/);
});

test("removes outdated documentation and lets crawlers observe missing routes", function () {
  assert.doesNotMatch(read("README.md"), /guia-do-estudante\\.html/);
  assert.doesNotMatch(read("robots.txt"), /Disallow: \\/guia-do-estudante/);
  assert.doesNotMatch(read("sitemap.xml"), /guia-do-estudante/);
});
