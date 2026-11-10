"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.join(__dirname, "..");

function load(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

test("final migration revokes only remaining privileged profile columns", () => {
  const migration = load(
    "supabase/migrations/20261110035225_finalize_profile_column_update_least_privilege.sql"
  );

  assert.match(
    migration,
    /revoke update \(enrolled, enrollment_code, class_type\)\s+on table public\.profiles from authenticated;/
  );
  assert.doesNotMatch(migration, /grant update on table public\.profiles to authenticated/i);
  assert.match(migration, /has_table_privilege\('service_role'/);
});

test("rollback restores only legacy column grants", () => {
  const rollback = load("docs/security/profile_legacy_update_rollback.sql");

  assert.match(rollback, /grant update \(enrolled, enrollment_code, class_type\)/);
  assert.doesNotMatch(rollback, /grant update on table public\.profiles to authenticated/i);
});

test("published profile clients use protected server workflows", () => {
  const teacherClient = load("tipo_turma_alunos.js");
  const studentData = load("student_data_utils.js");

  assert.match(teacherClient, /\.rpc\("set_teacher_student_profile_class_type"/);
  assert.doesNotMatch(teacherClient, /\.update\(\{ class_type:/);

  const payload = studentData.split("function buildProfilePayload(options) {")[1]
    .split("function buildUserMetadata")[0];
  assert.doesNotMatch(payload, /\benrolled\s*:/);
  assert.doesNotMatch(payload, /\benrollment_code\s*:/);
});
