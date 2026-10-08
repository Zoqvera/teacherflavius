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

test("finds no references to the retired guide anywhere else in the site source", function () {
  const allowedExtensions = new Set([
    ".html", ".js", ".mjs", ".cjs", ".ts", ".tsx",
    ".json", ".xml", ".md", ".css", ".txt", ".py", ".sql", ".yml", ".yaml"
  ]);
  const excludedDirectories = new Set([
    ".git", "node_modules", ".venv", "dist", "build", "coverage"
  ]);
  const thisTest = path.resolve(__filename);
  const remainingReferences = [];

  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) scan(entryPath);
        continue;
      }
      if (!entry.isFile() || !allowedExtensions.has(path.extname(entry.name))) continue;
      if (path.resolve(entryPath) === thisTest) continue;

      const content = fs.readFileSync(entryPath, "utf8");
      if (/guia-do-estudante|guiaDoEstudanteLink|studentGuide/.test(content)) {
        remainingReferences.push(path.relative(root, entryPath));
      }
    }
  }

  scan(root);
  assert.deepEqual(remainingReferences, []);
});
