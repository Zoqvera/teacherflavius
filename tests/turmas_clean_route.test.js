const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "turmas/index.html"), "utf8");
const visual = fs.readFileSync(path.join(ROOT, "turmas/turmas_visual.js"), "utf8");

test("clean /turmas route is static and does not rewrite the document", function () {
  assert.doesNotMatch(page, /document\.open\(/);
  assert.doesNotMatch(page, /document\.write\(/);
  assert.doesNotMatch(page, /fetch\(['"]\/turmas\.html/);
  assert.match(page, /id="classesGrid"/);
  assert.match(page, /src="\/turmas\.js\?v=20261009-capacity30-1"/);
  assert.match(page, /src="\/turmas\/turmas_visual\.js\?v=20261009-capacity30-1"/);
  assert.match(page, /href="\/turmas\/turmas_visual\.css\?v=20260929-save-buttons-1"/);
});

test("turmas visual enhancement script is syntactically valid", function () {
  assert.doesNotThrow(function () {
    new vm.Script(visual);
  });
  assert.doesNotMatch(visual, /return 5;\\\\n\s*if/);
});
