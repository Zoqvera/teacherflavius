const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase/migrations/20261021224000_preserve_paid_lesson_assignments.sql"),
  "utf8"
);

test("concurrent payment allocations take an advisory transaction lock", () => {
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(tuition_row\.student_id::text, 0\)\)/i);
});

test("already-issued contract credits freeze the purchase quantity", () => {
  assert.match(migration, /count\(\*\)::smallint[\s\S]*?existing\.tuition_id = tuition_row\.id/i);
  assert.match(migration, /existing\.credit_origin = 'contract'/i);
});

test("only untouched available contract credits may be assigned", () => {
  assert.match(migration, /pending_credits as \(/i);
  assert.match(migration, /existing\.status = 'available'/i);
  assert.match(migration, /existing\.cancelled_at is null/i);
  assert.match(migration, /existing\.makeup_booking_id is null/i);
  assert.match(migration, /existing\.regular_starts_at is null/i);
  assert.match(migration, /on conflict \(tuition_id, credit_number\) do update[\s\S]*?where private\.lesson_credits\.credit_origin = 'contract'/i);
  assert.match(migration, /private\.lesson_credits\.status = 'available'/i);
});

test("one student cannot claim the same weekly class slot twice across paid invoices", () => {
  assert.match(migration, /create unique index if not exists lesson_credits_unique_active_regular_slot/i);
  assert.match(migration, /on private\.lesson_credits \(student_id, regular_class_number, regular_starts_at\)/i);
  assert.match(migration, /claimed\.status in \('scheduled', 'used'\)/i);
  assert.match(migration, /claimed\.regular_starts_at/i);
  assert.match(migration, /claimed_tuition\.payment_date is not null/i);
});

test("enrollment on the class weekday starts only in the next week", () => {
  assert.match(migration, /candidate_date = \(assignment_time at time zone 'America\/Sao_Paulo'\)::date/i);
  assert.match(migration, /candidate_date := candidate_date \+ 7/i);
});

test("private functions retain private execution boundaries", () => {
  assert.match(migration, /revoke all on function private\.sync_lesson_credits_for_tuition\(uuid\)/i);
  assert.match(migration, /revoke all on function private\.assign_first_lesson_after_membership\(\)/i);
  assert.doesNotMatch(migration, /grant execute on function private/i);
});
