const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function readFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = readFile("supabase/migrations/20261017011148_expand_turma_47_to_nine.sql");
const baseline = readFile("supabase/baseline/387_expand_turma_47_to_nine.sql");
const workflow = readFile(".github/workflows/validate-supabase-baseline.yml");

test("nine-place exception is limited to the existing classes and Saturday 10h", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /class_number = 105/);
    assert.match(sql, /TURMA 47 - SAT 10H/);
    assert.match(sql, /set capacity_override = 9/);
    assert.match(sql, /tc\.class_number in \(47, 52, 105\) then 9/);
    assert.match(sql, /when tc\.class_type = 'quintet' then 8/);
    assert.match(sql, /tc\.class_number not in \(47, 52, 105\)/);
    assert.match(sql, /public\.set_teacher_class_type__mfa_inner/);
    assert.match(sql, /target_class_number in \(47, 52, 105\) then 9 else 8/);
  }
});

test("production migration checks the requested class identity", () => {
  assert.match(migration, /class_weekday = 6/);
  assert.match(migration, /class_start_time = time '10:00'/);
  assert.match(migration, /Expected TURMA 47 \(SAT 10H\)/);
});

test("recovery overlay tolerates empty class data", () => {
  assert.match(baseline, /A clean baseline restore has no class data/);
  assert.match(baseline, /if exists \(/);
  assert.doesNotMatch(baseline, /if not exists \(/);
  assert.match(workflow, /387_expand_turma_47_to_nine\.sql/);
});
