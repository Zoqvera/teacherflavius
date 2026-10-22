const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FILES = [
  "supabase/migrations/20261022013600_add_standard_100_four_lesson_plan.sql",
  "supabase/baseline/455_add_standard_100_four_lesson_plan.sql",
];

for (const file of FILES) {
  test(`${file} registers R$ 100 / 4 lessons without replacing R$ 100 / 8 lessons`, () => {
    const sql = fs.readFileSync(path.join(ROOT, file), "utf8");

    assert.match(sql, /'standard_100_4',\s*'R\$ 100,00 - 4 aulas por mês',\s*100\.00,\s*4,\s*true,\s*false/i);
    assert.match(sql, /on conflict \(monthly_fee, classes_per_month\) do nothing/i);
    assert.match(sql, /monthly_fee = 100\.00\s+and classes_per_month = 4/i);
    assert.match(sql, /monthly_fee = 100\.00\s+and classes_per_month = 8/i);
    assert.match(sql, /Existing R\$ 100 \/ 8-aula plan must remain active/i);
    assert.doesNotMatch(sql, /update\s+(?:public\.)?student_billing_settings/i);
    assert.doesNotMatch(sql, /update\s+(?:public\.)?monthly_tuition/i);
  });
}
