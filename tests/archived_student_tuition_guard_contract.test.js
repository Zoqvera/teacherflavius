const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = "supabase/migrations/20261009181637_prevent_new_tuition_for_archived_students.sql";
const baselinePath = "supabase/baseline/360_prevent_new_tuition_for_archived_students.sql";

function readRepositoryFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("archived tuition guard is preserved in migrations and recovery baseline", () => {
  const migration = readRepositoryFile(migrationPath);
  const baseline = readRepositoryFile(baselinePath);
  const workflow = readRepositoryFile(".github/workflows/validate-supabase-baseline.yml");

  assert.equal(migration, baseline);
  assert.match(workflow, /supabase\/baseline\/360_prevent_new_tuition_for_archived_students\.sql/);
});

test("archived students cannot receive newly generated tuition", () => {
  const migration = readRepositoryFile(migrationPath);

  assert.match(migration, /create or replace function private\.reject_new_tuition_for_archived_student\(\)/i);
  assert.match(migration, /coalesce\(profile\.archived, false\)/i);
  assert.match(migration, /for share/i);
  assert.match(migration, /before insert or update of student_id on public\.monthly_tuition/i);
  assert.match(migration, /using errcode = '23514'/i);
});

test("financial history is preserved and the trigger is not exposed as an RPC", () => {
  const migration = readRepositoryFile(migrationPath);

  assert.match(migration, /revoke all on function private\.reject_new_tuition_for_archived_student\(\)/i);
  assert.match(migration, /from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /\bdelete from public\.monthly_tuition\b/i);
  assert.doesNotMatch(migration, /\bupdate public\.monthly_tuition\b/i);
  assert.doesNotMatch(migration, /\bset is_exempt\b/i);
});
