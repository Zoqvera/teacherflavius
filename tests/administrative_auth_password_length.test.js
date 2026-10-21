const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

test("a technical student's password fits Supabase Auth's 72-byte limit", () => {
  const source = readFileSync(
    join(__dirname, "../supabase/functions/create-administrative-student/index.ts"),
    "utf8"
  );
  assert.match(source, /crypto\.randomUUID\(\)\.replaceAll\("-", ""\)/);
  const passwordCode = source.match(
    /const randomPassword = \[([\s\S]*?)\]\.join\(" "\)|const randomPassword = \[([\s\S]*?)\]\.join\(".*?"\);/
  );
  assert.ok(passwordCode, "The password should have an explicit random parts list.");
  const parts = passwordCode[1] || passwordCode[2];
  const uuidCount = (parts.match(/crypto\.randomUUID\(\)/g) || []).length;
  assert.equal(uuidCount, 2, "Exactly two random UUIDs are expected.");
  assert.match(parts, /"Aa1!"/, "The generated password meets common character rules.");
  const passwordLength = 32 * uuidCount + "Aa1!".length;
  assert.equal(passwordLength, 68);
  assert.ok(passwordLength <= 72);
  assert.match(source, /ban_duration: ACCESS_BAN_DURATION/);
  assert.doesNotMatch(source, /crypto\.randomUUID\(\) \+ crypto\.randomUUID\(\) \+ crypto\.randomUUID\(\)/);
});
