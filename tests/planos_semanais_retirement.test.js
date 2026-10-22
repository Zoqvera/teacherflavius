"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("professor dashboard omits the Planos Semanais card and keeps other reports", () => {
  const dashboard = read("professor.html");
  const icons = read("professor/professor_icons.js");

  assert.doesNotMatch(dashboard, /data-card-id="planos-semanais"|href="\/planos-semanais\/"/);
  assert.doesNotMatch(icons, /'planos-semanais':/);
  assert.match(dashboard, /data-card-id="relatorios"/);
  assert.doesNotMatch(dashboard, /data-card-id="radar-de-alunos"/);
  assert.match(dashboard, /professor_home\.js\?v=20261021-retire-[a-z-]+-1/);
});

test("professor dashboard removes retired cards from cached markup", () => {
  const script = read("professor_home.js");

  assert.match(script, /const RETIRED_PROFESSOR_CARD_IDS = Object\.freeze\(\[/);
  assert.match(script, /"planos-semanais"/);
  assert.match(script, /"radar-de-alunos"/);
  assert.match(script, /function removeRetiredProfessorCards\(\)/);
  assert.match(script, /if \(retiredCard\) retiredCard\.remove\(\);/);
  assert.ok(script.indexOf("removeRetiredProfessorCards();") < script.indexOf("ensureDynamicProfessorCards();"));
});

test("retired report URL displays a static notice without loading student data", () => {
  const page = read("planos-semanais/index.html");
  const robots = read("robots.txt");

  assert.match(page, /Planos Semanais descontinuado/);
  assert.match(page, /href="\/professor\/"/);
  assert.match(page, /<link rel="canonical" href="\/planos-semanais\/"/);
  assert.match(robots, /Disallow: \/planos-semanais\//);
  assert.doesNotMatch(page, /supabase_config|auth\.js|planos_semanais_dashboard|planos_semanais_visual/);
});

test("exclusive report code is deleted without removing academic records", () => {
  for (const file of [
    "planos_semanais_dashboard.js",
    "planos-semanais/planos_semanais_visual.js",
    "planos-semanais/planos_semanais_visual.css"
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), false, file);
  }
  assert.equal(fs.existsSync(path.join(ROOT, "supabase/migrations")), true);
});
