const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(filePath) {
  return fs.readFileSync(path.join(__dirname, "..", filePath), "utf8");
}

const migration = read("supabase/migrations/20261013225440_expand_quintet_classes_8_and_17_to_nine.sql");
const recoveryOverlay = read("supabase/baseline/385_expand_quintet_classes_8_and_17_to_nine.sql");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");
const classesView = read("turmas/turmas_visual.js");

test("two named classes receive nine spots without changing other quintet classes", () => {
  // The historical migration requires both live classes; a clean restore has no rows.
  assert.match(migration, /Expected both selected classes to be active/);
  assert.match(recoveryOverlay, /A clean restore has no class data/);
  assert.match(recoveryOverlay, /if exists \(/);
  assert.match(recoveryOverlay, /Existing selected classes must be active/);
  assert.match(migration, /class_number in \(47, 52\)/);
  assert.match(migration, /set capacity_override = 9/);
  assert.match(migration, /when tc\.class_type = 'quintet' and tc\.class_number in \(47, 52\) then 9/);
  assert.match(migration, /when tc\.class_type = 'quintet' then 8/);
  assert.match(migration, /tc\.class_number not in \(47, 52\)/);
});

test("administrative class type edits preserve specific nine-student exceptions", () => {
  assert.match(migration, /public\.set_teacher_class_type__mfa_inner\(integer,text\)/);
  assert.match(migration, /target_class_number in \(47, 52\) then 9 else 8/);
  assert.match(migration, /Class configuration implementation changed/);
});

test("teacher occupancy displays use the stored per-class capacity", () => {
  assert.match(classesView, /Number\(card\.dataset\.capacity\) \|\| 8/);
});

test("restore workflow executes the targeted exception after other overlays", () => {
  assert.match(workflow, /385_expand_quintet_classes_8_and_17_to_nine\.sql/);
  assert.ok(
    workflow.indexOf("385_expand_quintet_classes_8_and_17_to_nine.sql")
    > workflow.indexOf("380_same_day_first_tuition_payment.sql")
  );
});
