"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("teacher dashboard does not display retired exercise creator", () => {
  const page = read("professor.html");
  const script = read("professor_home.js");

  assert.doesNotMatch(page, /data-card-id="criar-exercicio"/);
  assert.match(script, /RETIRED_PROFESSOR_CARD_IDS = Object\.freeze\(\[[\s\S]*?"criar-exercicio"/);
});

test("exercise creator routes are informational and cannot submit or delete exercises", () => {
  for (const file of ["criar_exercicio.html", "criar-exercicio/index.html"]) {
    const page = read(file);
    assert.match(page, /Criar Exercício descontinuado/);
    assert.match(page, /href="\/professor\/"/);
    assert.doesNotMatch(page, /<form\b|create_teacher_exercise|delete_teacher_exercise|criar_exercicio\.js|supabase_config\.js|createExerciseForm/i);
  }
});

test("retirement revokes write access but preserves read permissions and data", () => {
  const migration = read("supabase/migrations/20261021224424_retire_teacher_exercise_creation.sql");
  assert.match(migration, /revoke execute on function public\.create_teacher_exercise/);
  assert.match(migration, /revoke execute on function public\.delete_teacher_exercise/);
  assert.match(migration, /revoke insert, update, delete on table public\.teacher_exercises/);
  assert.doesNotMatch(migration, /revoke select|truncate|delete\s+from|drop\s+table|drop\s+function|get_teacher_created_exercises/i);
});
