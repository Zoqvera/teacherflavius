const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("complete-cadastro.html");
const dueDay = read("student_tuition_due_day.js");
const migration = read(
  "supabase/migrations/20261001163500_require_all_enrollment_fields.sql"
);
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("every visible enrollment identity field is required", function () {
  assert.match(page, /id="enrollmentAccessCode"[^>]*required/);
  assert.doesNotMatch(page, /id="enrollmentAccessForm"[^>]*novalidate/);
  assert.match(page, /id="name"[^>]*required/);
  assert.match(page, /id="email"[^>]*required/);
  assert.match(page, /id="birthDate"[^>]*required/);
  assert.match(page, /id="cpf"[^>]*required/);
  assert.match(page, /id="whatsapp"[^>]*required/);
  assert.match(dueDay, /input\.required = state\.selectedDueDay == null/);
});

test("database activation rejects missing enrollment fields", function () {
  assert.match(migration, /new\.date_of_birth is null/);
  assert.match(migration, /length\(clean_cpf\) <> 11/);
  assert.match(migration, /length\(clean_whatsapp\) < 10/);
  assert.match(migration, /new\.tuition_due_day is null/);
  assert.match(migration, /nullif\(btrim\(coalesce\(new\.name/);
  assert.match(migration, /nullif\(btrim\(coalesce\(new\.email/);
});

test("access-code authorization remains mandatory before enrollment activation", function () {
  assert.match(
    migration,
    /from private\.student_enrollment_access access[\s\S]*access\.authorized_at is not null/i
  );
  assert.match(migration, /Valide o código de matrícula antes de concluir o cadastro/);
});

test("recovery baseline applies required-field enforcement", function () {
  assert.match(workflow, /105_require_all_enrollment_fields\.sql/);
});
