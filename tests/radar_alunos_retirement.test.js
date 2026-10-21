"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("Radar de Alunos is absent from the professor dashboard and icon registry", () => {
  const dashboard = read("professor.html");
  const icons = read("professor/professor_icons.js");
  const script = read("professor_home.js");

  assert.doesNotMatch(dashboard, /data-card-id="radar-de-alunos"|href="\/radar-de-alunos\/"/);
  assert.doesNotMatch(icons, /'radar-de-alunos':/);
  assert.match(script, /"radar-de-alunos"/);
  assert.match(script, /removeRetiredProfessorCards\(\);/);
  assert.match(dashboard, /professor_home\.js\?v=20261021-retire-exercise-1/);
  assert.match(dashboard, /professor_icons\.js\?v=20261021-retire-exercise-1/);
});

test("both legacy URLs explain retirement without loading student data", () => {
  for (const file of ["radar-de-alunos/index.html", "radar_alunos.html"]) {
    const page = read(file);
    assert.match(page, /Radar de Alunos descontinuado/, file);
    assert.match(page, /href="\/professor\/"/, file);
    assert.match(page, /<link rel="canonical" href="\/radar-de-alunos\/"/, file);
    assert.doesNotMatch(page, /radar_alunos\.js|radar_visual\.js|supabase_config\.js|auth\.js|radarList/, file);
  }
});

test("radar-specific runtime assets are deleted without touching shared academic records", () => {
  for (const file of [
    "radar_alunos.js",
    "radar-de-alunos/radar_visual.js",
    "radar-de-alunos/radar_visual.css"
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, file);
  }
  assert.equal(fs.existsSync(path.join(ROOT, "supabase/migrations")), true);
});

test("legacy route and robots exclusion are preserved", () => {
  assert.match(read("clean_urls.js"), /"\/radar_alunos\.html": "\/radar-de-alunos\/"/);
  assert.match(read("robots.txt"), /Disallow: \/radar-de-alunos\//);
});
