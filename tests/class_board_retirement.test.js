const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function read(filename) {
  return fs.readFileSync(path.join(root, filename), "utf8");
}

test("teacher navigation excludes the retired class board", () => {
  for (const filename of ["professor.html", "turmas.html", "turmas/index.html"]) {
    const html = read(filename);
    assert.equal(html.includes('href="/quadro-de-turmas/"'), false);
    assert.equal(html.includes("QUADRO DE TURMAS"), false);
    assert.equal(html.includes('data-card-id="quadro-de-turmas"'), false);
  }
});

test("both legacy entry points redirect to class management", () => {
  const html = read("quadro-de-turmas.html");
  const cleanRoute = read("clean_route_loader.js");

  assert.ok(html.includes('window.location.replace("/turmas/")'));
  assert.ok(html.includes('http-equiv="refresh" content="0;url=/turmas/"'));
  assert.ok(html.includes('href="/turmas/"'));
  assert.equal(html.includes("get_teacher_class_students"), false);
  assert.equal(html.includes("toggle_teacher_student_tag"), false);
  assert.ok(cleanRoute.includes('"/quadro-de-turmas/"'));
});

test("search restrictions and active class controls remain intact", () => {
  assert.ok(read("robots.txt").includes("Disallow: /quadro-de-turmas/"));
  assert.ok(read("quadro-de-turmas.html").includes('name="robots" content="noindex,follow"'));
  assert.ok(read("turmas.html").includes('id="classType"'));
  assert.ok(read("turmas/index.html").includes('id="classType"'));
  assert.equal(read("animated_cards.js").includes("ClassTypeBadges"), false);
});
