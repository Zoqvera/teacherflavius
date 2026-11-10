"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase/migrations/20261110142911_fix_first_tuition_trigger_on_google_enrollment.sql"
  ),
  "utf8"
);

test("first tuition trigger detects enrollment performed by a BEFORE UPDATE hook", function () {
  assert.match(
    migration,
    /drop trigger if exists ensure_first_tuition_after_profile_enrollment\s+on public\.profiles/i
  );
  assert.match(
    migration,
    /create trigger ensure_first_tuition_after_profile_enrollment\s+after update on public\.profiles\s+for each row/i
  );
  assert.doesNotMatch(migration, /after update of enrolled on public\.profiles/i);
  assert.match(
    migration,
    /old\.enrolled is distinct from new\.enrolled\s+and new\.enrolled is true/i
  );
  assert.match(
    migration,
    /execute function private\.ensure_first_tuition_after_profile_enrollment\(\)/i
  );
});
