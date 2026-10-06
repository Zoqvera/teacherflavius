const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const manualGrantMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006013429_support_manual_lesson_credit_grants.sql"),
  "utf8"
);
const canonicalCreditEligibility = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261006035538_canonicalize_replacement_credit_eligibility.sql"),
  "utf8"
);
const canonicalCreditEligibilityBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/260_canonicalize_replacement_credit_eligibility.sql"),
  "utf8"
);

test("manual lesson credits remain durable", function () {
  assert.match(manualGrantMigration, /credit_origin text not null default 'contract'/i);
  assert.match(manualGrantMigration, /manual_grant/i);
  assert.match(manualGrantMigration, /credit\.credit_origin = 'contract'/i);
  assert.match(manualGrantMigration, /private\.lesson_credits\.credit_origin = 'contract'/i);
});

function assertCanonicalCreditEligibility(sql) {
  assert.match(sql, /create or replace function private\.is_replacement_credit_eligible/i);
  assert.match(sql, /credit_origin = 'manual_grant'/i);
  assert.match(sql, /credit_origin = 'contract'/i);
  assert.match(sql, /cancelled_at <= regular_starts_at - interval '12 hours'/i);
  assert.match(sql, /get_my_lessons_overview[\s\S]*private\.is_replacement_credit_eligible/i);
  assert.match(sql, /get_my_replacement_options[\s\S]*private\.is_replacement_credit_eligible/i);
  assert.match(sql, /book_my_lesson_replacement[\s\S]*private\.is_replacement_credit_eligible/i);
  assert.match(sql, /Este crédito não está elegível para reposição/i);
  assert.doesNotMatch(
    sql,
    /Este crédito não foi gerado por um cancelamento feito dentro do prazo/i
  );
}

test("replacement credit eligibility is canonical across read and booking paths", function () {
  for (const sql of [canonicalCreditEligibility, canonicalCreditEligibilityBaseline]) {
    assertCanonicalCreditEligibility(sql);
  }
});
