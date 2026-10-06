const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "complete-cadastro.html"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006020321_require_enrollment_class_mode.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/240_require_enrollment_class_mode.sql"),
  "utf8"
);

test("enrollment requires the student to choose individual or group lessons", function () {
  assert.match(page, /<select id="classMode" required>/);
  assert.match(page, /<option value="group">Aulas em grupo<\/option>/);
  assert.match(page, /<option value="individual">Aulas individuais<\/option>/);
  assert.match(page, /classMode === "group"[\s\S]*"QUINTETO"/);
  assert.match(page, /classMode === "individual"[\s\S]*"INDIVIDUAL"/);
  assert.match(page, /set_my_enrollment_class_mode/);
  assert.match(page, /target_mode: classMode/);
});

test("database activation accepts only the two enrollment classifications", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /new\.class_type is null/);
    assert.match(sql, /new\.class_type not in \('INDIVIDUAL', 'QUINTETO'\)/);
    assert.match(sql, /aulas individuais ou em grupo/i);
  }
});

test("group enrollment is persisted as QUINTETO rather than a new database class type", function () {
  assert.match(page, /classMode === "group"[\s\S]*"QUINTETO"/);
  assert.doesNotMatch(migration, /'GROUP'/);
  assert.doesNotMatch(migration, /'GRUPO'/);
});

test("lesson type persistence is restricted to authorized incomplete enrollment", function () {
  const rpc = fs.readFileSync(
    path.join(ROOT, "supabase/migrations/20261006020622_add_enrollment_class_mode_rpc.sql"),
    "utf8"
  );

  assert.match(rpc, /auth\.uid\(\)/);
  assert.match(rpc, /profile_row\.enrolled/);
  assert.match(rpc, /profile_row\.profile_completed/);
  assert.match(rpc, /student_enrollment_access/);
  assert.match(rpc, /when 'group' then 'QUINTETO'/);
  assert.match(rpc, /when 'individual' then 'INDIVIDUAL'/);
  assert.match(rpc, /revoke execute[\s\S]*from public, anon/i);
  assert.match(rpc, /grant execute[\s\S]*to authenticated/i);
});
