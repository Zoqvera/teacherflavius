const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const migration = read("supabase/migrations/20261009195522_set_experimental_class_capacity_thirty.sql");

test("experimental capacities become 30 without changing regular class capacities", () => {
  assert.match(migration, /capacity_override = 30/);
  assert.match(migration, /where class_type = 'experimental'/);
  assert.match(migration, /private\.get_class_operational_capacity\(class_number\) is distinct from 30/);
  assert.match(migration, /when normalized_type = 'quintet' then 8/);
  assert.match(migration, /when normalized_type = 'experimental' then 30/);
});

test("editing or converting an experimental class preserves the 30-place default", () => {
  assert.match(migration, /when class_type = 'experimental' then coalesce\(capacity_override, 30\)/);
  assert.match(migration, /else 30/);
});

test("teacher interfaces display 30 experimental places", () => {
  assert.match(read("turmas.js"), /classItem\.class_type === "experimental" \? 30 : 8/);
  assert.match(read("turmas\/turmas_visual.js"), /experimental"\)\) return Number\(card\.dataset\.capacity\) \|\| 30/);
  assert.match(read("quadro-de-turmas\/quadro_visual.js"), /experimental'\)\) return 30/);
  assert.match(read("docs\/sql_class_type_retirement.md"), /30 participantes por sessão/);
});
