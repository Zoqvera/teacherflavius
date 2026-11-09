"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const catalogScript = fs.readFileSync(path.join(root, "student_acquisition.js"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20261109155035_add_anuncio80_acquisition_origin.sql"),
  "utf8"
);

function loadAcquisition(selectedSource) {
  const window = {};
  const context = {
    window,
    document: { getElementById: () => ({ value: selectedSource }) }
  };
  vm.runInNewContext(catalogScript, context);
  return window.StudentAcquisition;
}

test("anúncio80 is a distinct student acquisition origin", () => {
  const catalog = loadAcquisition("anúncio80");
  const option = catalog.sources.find(source => source.value === "anúncio80");
  assert.equal(option.label, "Anúncio de R$ 80 (Instagram)");
  assert.equal(catalog.label("anúncio80"), option.label);
  assert.equal(catalog.label("instagram"), "Instagram");
  assert.equal(catalog.read("source", "detail", true).source, "anúncio80");
  assert.equal(catalog.read("source", "detail", true).detail, null);
});

test("migration extends all capture channels without assigning the origin to legacy students", () => {
  for (const table of [
    "private.student_acquisition",
    "private.promotion_reservations",
    "private.trial_lesson_appointments"
  ]) {
    assert.ok(migration.includes("alter table " + table), table);
  }
  assert.match(migration, /when token = 'anuncio80' then 'anúncio80'/);
  assert.match(migration, /perform private\.validate_acquisition_origin\('anúncio80', null\)/);
  assert.doesNotMatch(migration, /update\s+private\.student_acquisition\s+set\s+declared_source/i);
});
