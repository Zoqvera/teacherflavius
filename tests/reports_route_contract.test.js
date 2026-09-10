const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const repositoryRoot = path.resolve(__dirname, "..");
const reportsIndexPath = path.join(repositoryRoot, "relatorios", "index.html");
const legacyReportsPath = path.join(repositoryRoot, "relatorios.html");

test("publishes reports through a single canonical route namespace", function () {
  const reportsHtml = fs.readFileSync(reportsIndexPath, "utf8");

  assert.match(
    reportsHtml,
    /data-embed-src="\/relatorios\/sincronizacao\//,
    "The reports hub must load synchronization from its canonical clean route."
  );
  assert.doesNotMatch(
    reportsHtml,
    /data-embed-src="\/relatorios\.html/,
    "The reports hub must not depend on the legacy colliding HTML entry point."
  );
  assert.equal(
    fs.existsSync(legacyReportsPath),
    false,
    "relatorios.html must not coexist with relatorios/index.html on GitHub Pages."
  );
});
