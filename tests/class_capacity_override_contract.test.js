const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260925184216_add_per_class_capacity_override_and_expand_class_36.sql"),
  "utf8"
);

test("supports explicit per-class capacity overrides", function () {
  assert.match(migration, /add column if not exists capacity_override smallint/);
  assert.match(migration, /capacity_override between 1 and 50/);
  assert.match(migration, /coalesce\(\s*tc\.capacity_override::integer/);
});

test("expands class 36 to ten students without changing global group defaults", function () {
  assert.match(migration, /set capacity_override = 10/);
  assert.match(migration, /where class_number = 36/);
  assert.match(migration, /when tc\.class_type in \('quartet', 'quintet'\) then 5/);
  assert.match(migration, /when tc\.class_type = 'eight_students' then 8/);
});
