const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const driftChecker = fs.readFileSync(
  path.join(__dirname, "..", "scripts/check_supabase_migration_drift.sh"),
  "utf8"
);

test("lesson membership migration alias is pinned to exact verified SQL digest", () => {
  const identity = [
    "20261020180500",
    "20261020192815",
    "guard_lessons_before_class_membership",
    "56817fb3bce31e642645f624200fb8f2ae0583246852d8414927be98bbf13067"
  ].join("|");

  assert.equal(driftChecker.split(identity).length - 1, 1);
  assert.match(driftChecker, /local_identity.*expected_git/);
  assert.match(driftChecker, /remote_identity.*expected_remote/);
  assert.match(
    driftChecker,
    /if \[\[ "\$local_identity" == "\$expected_git" && "\$remote_identity" == "\$expected_remote" \]\]/
  );
});
