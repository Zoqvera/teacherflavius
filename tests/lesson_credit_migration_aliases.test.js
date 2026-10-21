const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(
  path.join(__dirname, "..", "scripts/check_supabase_migration_drift.sh"),
  "utf8"
);

test("late-fee migration aliases require exact production names and SHA256", () => {
  const expectedRecords = [
    "20261020133230|20261020175958|late_payment_policy_quote_foundation|086ead16caddc509b63e610b548d58b38dbe26a4b23d1172437ec6cf6d1eb534",
    "20261020164300|20261020180038|late_payment_settlement_gateway|19ad5781909218ee29e4bd553477cfd80e03b97b9bd452234c9dfaaedbaf6814"
  ];
  for (const record of expectedRecords) {
    assert.equal(script.split(record).length - 1, 1, "Expected one pinned alias record");
  }
  assert.match(script, /local_identity.*expected_git/);
  assert.match(script, /remote_identity.*expected_remote/);
  assert.match(script, /if \[\[ "\$local_identity" == "\$expected_git" && "\$remote_identity" == "\$expected_remote" \]\]/);
});
