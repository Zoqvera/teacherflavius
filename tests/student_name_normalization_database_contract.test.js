const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20261008180010_align_student_name_normalization_and_remove_auth_trigger.sql"
  ),
  "utf8"
);

test("database title case capitalizes after punctuation consistently", function () {
  assert.match(migration, /current_char ~ '\[\[:alpha:\]\]'/i);
  assert.match(migration, /capitalize_next := true/i);
  assert.match(migration, /when capitalize_next then upper\(current_char\)/i);
});

test("student-name normalization no longer installs a global auth users trigger", function () {
  assert.match(
    migration,
    /drop trigger if exists normalize_auth_student_names_before_write on auth\.users/i
  );
  assert.match(
    migration,
    /drop function if exists private\.normalize_auth_student_name_before_write\(\)/i
  );
  assert.doesNotMatch(migration, /create trigger .* on auth\.users/i);
});

test("database backfill stays limited to student operational tables", function () {
  assert.match(migration, /update public\.profiles/i);
  assert.match(migration, /update public\.student_enrollments/i);
  assert.match(migration, /update public\.student_enrollment_invites/i);
  assert.match(migration, /update public\.makeup_class_bookings/i);
  assert.match(migration, /update public\.exercise_sync_events/i);
  assert.doesNotMatch(migration, /update auth\.users/i);
});
