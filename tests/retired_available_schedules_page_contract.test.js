const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const studentArea = fs.readFileSync(path.join(ROOT, "area_do_estudante.html"), "utf8");
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");

test("available schedules page is retired from the student area", function () {
  assert.equal(fs.existsSync(path.join(ROOT, "horarios-disponiveis/index.html")), false);
  assert.doesNotMatch(studentArea, /\/horarios-disponiveis\//);
  assert.doesNotMatch(studentArea, /HORÁRIOS DISPONÍVEIS/);
});

test("retired URL is not blocked in robots so its missing status can be discovered", function () {
  assert.doesNotMatch(robots, /Disallow:\s*\/horarios-disponiveis\//);
});
