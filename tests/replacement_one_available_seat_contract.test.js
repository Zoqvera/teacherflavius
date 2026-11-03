const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261103212635_allow_replacement_with_one_operational_vacancy.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/465_allow_replacement_with_one_operational_vacancy.sql"),
  "utf8"
);
const policy = fs.readFileSync(
  path.join(ROOT, "docs/individual_replacement_policy.md"),
  "utf8"
);
const workflow = fs.readFileSync(
  path.join(ROOT, ".github/workflows/validate-supabase-baseline.yml"),
  "utf8"
);

test("replacement needs one operational vacancy in production and restored baseline", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /create or replace function private\.is_replacement_occurrence_eligible\(\s*available_spots integer,\s*cancellation_spots_available integer\s*\)/i);
    assert.match(sql, /select available_spots >= 1\s*;/i);
    assert.doesNotMatch(sql, /available_spots >= 4|cancellation_spots_available >= 1/i);
    assert.match(sql, /revoke execute on function private\.is_replacement_occurrence_eligible\(integer, integer\)/i);
  }
});

test("baseline restore and business documentation follow the new policy", () => {
  assert.match(workflow, /supabase\/baseline\/465_allow_replacement_with_one_operational_vacancy\.sql/);
  assert.match(policy, /QUINTETO[\s\S]*pelo menos uma vaga real dispon[ií]vel/i);
  assert.doesNotMatch(policy, /pelo menos quatro vagas ou uma vaga/i);
});
