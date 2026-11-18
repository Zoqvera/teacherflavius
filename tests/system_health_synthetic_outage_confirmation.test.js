const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20261118182532_confirm_repeated_synthetic_outages.sql"),
  "utf8",
);

test("critical availability requires two consecutive five-minute probe cycles", () => {
  assert.match(migration, /probe_previous_failed_count integer := 0/);
  assert.match(migration, /date_bin\(/);
  assert.match(migration, /'5 minutes'/);
  assert.match(migration, /'12 minutes'/);
  assert.match(migration, /probe_failed_count >= 2 and probe_previous_failed_count >= 2/);
});

test("the first failing probe cycle is a warning, not a critical outage", () => {
  assert.match(migration, /elsif probe_failed_count > 0 then/);
  assert.match(migration, /'synthetic_availability_failure', 'warning'/);
  assert.match(migration, /'synthetic_previous_failed_targets', probe_previous_failed_count/);
});

test("escalation is not suppressed by warning deduplication", () => {
  assert.match(migration, /issue_record\.issue_code = 'synthetic_availability_failure'/);
  assert.match(migration, /then ':' \|\| issue_record\.severity else '' end/);
});
