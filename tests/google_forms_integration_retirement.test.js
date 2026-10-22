"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = filename => fs.readFileSync(path.join(ROOT, filename), "utf8");

test("retired Google Forms is not accessible through the professor dashboard", () => {
  const page = read("professor.html");
  const navigation = read("professor_home.js");
  const icons = read("professor/professor_icons.js");

  assert.doesNotMatch(page, /data-card-id="integracao-google-forms"|href="\/integracao-google-forms\/"/);
  assert.match(navigation, /RETIRED_PROFESSOR_CARD_IDS = Object\.freeze\(\[[\s\S]*?"integracao-google-forms"/);
  assert.doesNotMatch(icons, /'integracao-google-forms':/);
});

test("retired Google Forms route has no administration UI", () => {
  const page = read("integracao-google-forms/index.html");
  assert.match(page, /Integração Google Forms descontinuada/);
  assert.match(page, /name="robots" content="noindex,nofollow"/);
  assert.match(page, /href="\/professor\/"/);
  assert.doesNotMatch(page, /<form\b|<script\b|integrationForm|connectButton|supabase_config|Apps Script/i);
});

test("both synchronization endpoints reject every request without database writes", () => {
  const functions = [
    "supabase/functions/google-forms-exercise-sync/index.ts",
    "supabase/functions/google-forms-integration-manager/index.ts"
  ];

  for (const path of functions) {
    const source = read(path);
    assert.match(source, /status: 410/);
    assert.match(source, /status: "retired"/);
    assert.match(source, /Deno\.serve/);
    assert.doesNotMatch(source, /createClient|from\(|\.rpc\(|\.insert\(|\.upsert\(|\.update\(|getDefaultKey|x-sync-secret/);
  }
});

test("database migration prevents new integrations without deleting historical results", () => {
  const migration = read("supabase/migrations/20261022014603_retire_google_forms_integration_20261021.sql");
  assert.match(migration, /revoke execute on function public\.upsert_google_form_integration/);
  assert.match(migration, /revoke execute on function public\.retry_google_form_integration/);
  assert.match(migration, /revoke execute on function public\.disconnect_google_form_integration/);
  assert.match(migration, /status = 'disconnected'/);
  assert.doesNotMatch(migration, /delete\s+from|truncate\s+|drop\s+(table|function)|daily_exercise_completion|exercise_sync_events/i);
});
