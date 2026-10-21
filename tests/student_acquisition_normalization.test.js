const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(
    __dirname, "..", "supabase", "migrations",
    "20261020133138_canonicalize_student_acquisition_sources_20261020.sql"
  ),
  "utf8"
);

test("all acquisition capture paths normalize at the database boundary", () => {
  assert.match(migration, /function private\.canonical_acquisition_source\(/);
  assert.match(migration, /function private\.save_student_acquisition\(/);
  assert.match(migration, /function private\.validate_acquisition_origin\(/);
  for (const table of [
    "private.student_acquisition",
    "private.promotion_reservations",
    "private.trial_lesson_appointments"
  ]) {
    assert.ok(migration.includes("on " + table), table);
  }
});

test("canonicalization keeps audit history and conservatively preserves other sources", () => {
  assert.match(migration, /'chatgptopenai'/);
  assert.match(migration, /'indicacao'/);
  assert.match(migration, /'getninjas'/);
  assert.match(migration, /'Chat gpt'\) <> 'chatgpt'/);
  assert.match(migration, /'TikTok'\) <> 'other'/);
  assert.match(migration, /'WhatsApp'\) <> 'other'/);
  assert.match(migration, /'normalization', null/);
  assert.match(migration, /student_acquisition_history/);
  assert.match(migration, /technical_attribution = case/);
});
