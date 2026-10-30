const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (relativePath) =>
  fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");

const migration = read(
  "supabase/migrations/20261030141320_flexible_per_class_capacity.sql"
);
const classesScript = read("turmas.js");
const classIndex = read("turmas/index.html");
const classAlias = read("turmas.html");

test("QUINTETO uses each class capacity override without class-number exceptions", () => {
  assert.match(migration, /create or replace function private\.get_class_operational_capacity/);
  assert.match(migration, /tc\.capacity_override::integer/);
  assert.doesNotMatch(
    migration.match(/create or replace function private\.get_class_operational_capacity[\s\S]*?\$function\$;/)?.[0] || "",
    /tc\.class_number\s*=\s*(47|52)/
  );
});

test("the backend rejects reducing capacity below occupied or reserved places", () => {
  assert.match(migration, /private\.count_class_seat_members\(new\.class_number\)/);
  assert.match(migration, /private\.count_class_seat_holds\(new\.class_number\)/);
  assert.match(migration, /before update of capacity_override, class_type/);
  assert.match(migration, /pg_catalog\.pg_advisory_xact_lock\(73008/);
  assert.match(migration, /target_capacity not between 1 and 50/);
});

test("custom capacity survives administrative type and schedule saves", () => {
  assert.match(migration, /when normalized_type = previous_type then/);
  assert.match(migration, /previous_capacity::integer/);
  assert.match(migration, /public\.save_teacher_class_configuration/);
  assert.match(classesScript, /client\.rpc\("save_teacher_class_configuration"/);
  assert.doesNotMatch(classesScript, /client\.rpc\("set_teacher_class_type"/);
});

test("new class capacity is created transactionally and checked on the server", () => {
  assert.match(migration, /create or replace function public\.create_teacher_class_with_capacity/);
  assert.match(migration, /public\.create_teacher_class_with_type__mfa_inner/);
  assert.match(classesScript, /client\.rpc\("create_teacher_class_with_capacity"/);
});

test("the admin screen exposes independently configurable 1-50 seat limits", () => {
  for (const page of [classIndex, classAlias]) {
    assert.match(page, /id="classCapacity" type="number" min="1" max="50"/);
    assert.match(page, /turmas\.js\?v=20261030-flexible-1/);
  }
  assert.match(classesScript, /data-class-capacity-input=/);
  assert.match(classesScript, /function parseClassCapacity/);
  assert.match(classesScript, /target_capacity: capacity/);
});
