const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006013429_support_manual_lesson_credit_grants.sql"),
  "utf8"
);

test("manual lesson credits are durable and replacement eligible", function () {
  assert.match(migration, /credit_origin text not null default 'contract'/i);
  assert.match(migration, /manual_grant/i);
  assert.match(migration, /credit\.credit_origin = 'contract'/i);
  assert.match(migration, /credit\.credit_origin = 'manual_grant'/i);
  assert.match(migration, /credit_row\.credit_origin <> 'manual_grant'/i);
  assert.match(migration, /private\.lesson_credits\.credit_origin = 'contract'/i);
});
