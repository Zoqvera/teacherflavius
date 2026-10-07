const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261007022820_retire_legacy_makeup_student_flow.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/310_retire_legacy_makeup_student_flow.sql"),
  "utf8"
);
const cleanUrls = fs.readFileSync(path.join(ROOT, "clean_urls.js"), "utf8");
const legacyRootPage = fs.readFileSync(path.join(ROOT, "reposicoes.html"), "utf8");
const legacyCleanPage = fs.readFileSync(path.join(ROOT, "reposicoes/index.html"), "utf8");

function assertLegacyRetirement(sql) {
  assert.match(sql, /slot\.starts_at > now\(\)/i);
  assert.match(sql, /private\.get_active_settled_tuition_id/i);
  assert.match(sql, /'used',[\s\S]*'manual_grant'/i);
  assert.match(sql, /makeup_booking_id/i);
  assert.match(
    sql,
    /revoke execute on function public\.book_makeup_class\(uuid\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /revoke execute on function public\.cancel_my_makeup_class_booking\(uuid\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /revoke execute on function public\.get_available_makeup_slots\(\)[\s\S]*from public, anon, authenticated/i
  );
  assert.match(
    sql,
    /revoke execute on function public\.get_my_makeup_bookings\(\)[\s\S]*from public, anon, authenticated/i
  );
  assert.doesNotMatch(sql, /revoke execute on function public\.cancel_makeup_class_booking\(uuid\)/i);
}

test("legacy future reservations enter the canonical credit flow before legacy access is revoked", function () {
  assertLegacyRetirement(migration);
  assertLegacyRetirement(baseline);
});

test("the retired student route only redirects to Minhas Aulas", function () {
  for (const page of [legacyRootPage, legacyCleanPage]) {
    assert.match(page, /name="robots" content="noindex, nofollow"/i);
    assert.match(page, /\/area-do-estudante\/minhas-aulas\//);
    assert.doesNotMatch(page, /get_available_makeup_slots|book_makeup_class|cancel_my_makeup_class_booking/i);
  }

  assert.match(
    cleanUrls,
    /"\/reposicoes\.html": "\/area-do-estudante\/minhas-aulas\/"/
  );
  assert.equal(fs.existsSync(path.join(ROOT, "reposicoes.js")), false);
});
