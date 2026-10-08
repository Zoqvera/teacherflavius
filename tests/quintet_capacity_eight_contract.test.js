const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read("supabase/migrations/20261002031500_set_quintet_capacity_eight.sql");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");
const vacancyReport = read("relatorios_vagas_turmas.html");

test("recovery overlay provisions per-class capacity overrides", function () {
  const recoveryOverlay = read("supabase/baseline/115_set_quintet_capacity_eight.sql");
  assert.match(recoveryOverlay, /add column if not exists capacity_override smallint/);
  assert.match(recoveryOverlay, /teacher_classes_capacity_override_range/);
  assert.match(recoveryOverlay, /capacity_override between 1 and 50/);
});

test("normalizes every existing quintet capacity override to eight", function () {
  assert.match(migration, /set capacity_override = 8/);
  assert.match(migration, /where class_type = 'quintet'/);
});

test("operational capacity fixes quintet at eight regardless of legacy overrides", function () {
  assert.match(migration, /when tc\.class_type = 'quintet' then 8/);
  assert.match(migration, /private\.get_class_operational_capacity/);
});

test("future quintet creation and classification persist capacity eight", function () {
  assert.match(
    migration,
    /case when normalized_type = 'quintet' then 8 else null end/
  );
  assert.match(
    migration,
    /when normalized_type = 'quintet' then 8[\s\S]*when class_type = 'quintet' then null/
  );
});

test("vacancy queries use centralized operational capacity for quintets", function () {
  assert.match(
    migration,
    /tc\.class_type in \('quartet', 'quintet'\)/
  );
  assert.match(
    migration,
    /greatest\(0, cc\.capacity_limit - cc\.occupied_spots\)/
  );
});

test("vacancy report derives displayed capacity from backend counts", function () {
  const derivedCapacity =
    /Number\(row\.occupied_spots\|\|0\)\+Number\(row\.available_spots\|\|0\)/;
  assert.match(vacancyReport, derivedCapacity);
});

test("recovery baseline applies quintet capacity overlay", function () {
  assert.match(workflow, /115_set_quintet_capacity_eight\.sql/);
});
