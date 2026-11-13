const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261113043000_cascade_student_preparation_reminders_on_privacy_deletion.sql",
  ),
  "utf8",
);

test("profile deletion automatically removes only its preparation reminders", () => {
  assert.match(
    migration,
    /alter table public\.student_preparation_email_reminders\s+add constraint student_preparation_email_reminders_student_id_fkey\s+foreign key \(student_id\)\s+references public\.profiles\(id\)\s+on delete cascade;/i,
  );
  assert.match(
    migration,
    /alter table public\.student_preparation_email_reminders\s+drop constraint student_preparation_email_reminders_student_id_fkey;/i,
  );
});

test("the migration fails closed on unexpected foreign-key drift and supports reapplication", () => {
  assert.match(
    migration,
    /constraint_definition\.confrelid = 'public\.profiles'::regclass/i,
  );
  assert.match(migration, /if not found then\s+raise exception/i);
  assert.match(migration, /if current_delete_action = 'c' then\s+return;/i);
  assert.match(
    migration,
    /if current_delete_action <> 'a' then\s+raise exception/i,
  );
});

test("student deletion leaves financial retention and authorization logic unchanged", () => {
  assert.doesNotMatch(migration, /\b(?:delete from|truncate|update)\s+public\.monthly_tuition\b/i);
  assert.doesNotMatch(migration, /\b(?:delete from|truncate|update)\s+auth\.users\b/i);
  assert.doesNotMatch(migration, /\bcreate or replace function\b/i);
  assert.doesNotMatch(migration, /\balter table public\.profiles\b/i);
});
