const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261007051850_class_lesson_history_quality_semantics.sql",
);
const baseline = read(
  "supabase/baseline/335_class_lesson_history_quality_semantics.sql",
);
const dashboard = read("system_health_dashboard.js");
const notifier = read("supabase/functions/notify-system-health-alert/index.ts");

for (const [name, sql] of [
  ["migration", migration],
  ["baseline", baseline],
]) {
  test(`${name} keeps retained class lesson history informational`, () => {
    assert.match(sql, /lesson_deleted_class_history_info/);
    assert.match(
      sql,
      /clr\.class_date <= \(now\(\) at time zone 'America\/Sao_Paulo'\)::date/,
    );
    assert.match(
      sql,
      /clr\.class_date > \(now\(\) at time zone 'America\/Sao_Paulo'\)::date/,
    );
    assert.match(sql, /lesson_created_after_class_deactivation/);
    assert.match(sql, /clr\.created_at > tc\.updated_at/);
    assert.match(sql, /if lesson_orphan_class > 0 then/);
    assert.match(
      sql,
      /'data_quality_lesson_orphan_class'[\s\S]*'future_count'[\s\S]*'created_after_deactivation_count'/,
    );
    assert.doesNotMatch(sql, /data_quality_lesson_deleted_class_history/);
  });
}

test("dashboard exposes retained history as an informational metric", () => {
  assert.match(dashboard, /lesson_deleted_class_history_info/);
  assert.match(dashboard, /Histórico preservado/);
  assert.match(
    dashboard,
    /Registro de lição com referência de turma inválida/,
  );
});

test("notifier describes the actionable lesson-class finding precisely", () => {
  assert.match(
    notifier,
    /Alerta: registro de lição com referência de turma inválida/,
  );
});
