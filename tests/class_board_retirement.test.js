const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");

test("the teacher navigation no longer exposes the retired class board", () => {
  for (const filename of ["professor.html", "turmas.html", "turmas/index.html"]) {
    assert.doesNotMatch(read(filename), /href="(?:\\/quadro-de-turmas\\/|quadro-de-turmas\\.html)"/);
    assert.doesNotMatch(read(filename), /data-card-id="quadro-de-turmas"/);
  }
});

test("legacy class board URLs lead to the active class management section", () => {
  const legacy = read("quadro-de-turmas.html");
  assert.match(legacy, /window\\.location\\.replace\\("\\/turmas\\/"\\)/);
  assert.match(legacy, /http-equiv="refresh" content="0;url=\\/turmas\\/"/);
  assert.match(legacy, /href="\\/turmas\\/"/);
  assert.doesNotMatch(legacy, /get_teacher_class_students|toggle_teacher_student_tag|loadBoard/);
  assert.match(read("clean_route_loader.js"), /"\\/quadro-de-turmas\\/": "\\/quadro-de-turmas\\.html"/);
});

test("SEO protections and class management remain intact", () => {
  assert.match(read("robots.txt"), /Disallow: \\/quadro-de-turmas\\//);
  assert.match(read("quadro-de-turmas.html"), /name="robots" content="noindex,follow"/);
  assert.match(read("turmas.html"), /id="classType"/);
  assert.match(read("turmas/index.html"), /id="classType"/);
  assert.doesNotMatch(read("animated_cards.js"), /ClassTypeBadges|ClassTypeBadgeRenderer|ClassTypeService/);
});
