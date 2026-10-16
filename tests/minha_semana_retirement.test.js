"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (filePath) => fs.readFileSync(path.join(ROOT, filePath), "utf8");

test("the student area no longer renders the weekly card or its empty section", function () {
  const page = read("area_do_estudante.html");
  const shell = read("area-do-estudante/index.html");

  assert.equal(page.includes("MINHA SEMANA"), false);
  assert.equal(page.includes('href="/minha-semana/"'), false);
  assert.equal(page.includes("priority-group"), false);
  assert.equal(shell.includes("20261016-retire-week-1"), true);
});

test("the old weekly address is a static retirement notice with safe navigation", function () {
  const page = read("minha-semana/index.html");

  assert.equal(page.includes("Minha Semana descontinuada"), true);
  assert.equal(page.includes('href="/area-do-estudante/"'), true);
  assert.equal(page.includes('<link rel="canonical" href="/minha-semana/">'), true);
  assert.equal(page.includes("minha_semana_dashboard.js"), false);
  assert.equal(page.includes("supabase_config.js"), false);
  assert.equal(fs.existsSync(path.join(ROOT, "minha_semana_dashboard.js")), false);
});

test("stale cached student cards are removed even when the page HTML is old", function () {
  const script = read("area_do_estudante.js");

  assert.equal(script.includes('"/minha-semana"'), true);
  assert.equal(script.includes("removeUnavailableStudentCards();"), true);
  assert.equal(script.includes('formerPriorityGroup.remove();'), true);
});

test("public marketing and student app listing do not advertise the retired feature", function () {
  const marketing = read("curso-de-ingles-online/index.html");
  const listing = JSON.parse(read("mobile/google_play_listing_pt_BR.json"));

  assert.equal(marketing.includes("<strong>Minha Semana</strong>"), false);
  assert.equal(listing.fullDescription.includes("Minha Semana"), false);
});

test("the professor's former weekly report also displays a retirement notice", function () {
  const page = read("planos-semanais/index.html");

  assert.equal(page.includes("Planos Semanais descontinuado"), true);
  assert.equal(page.includes("planos_semanais_dashboard.js"), false);
  assert.equal(page.includes('href="/professor/"'), true);
});
