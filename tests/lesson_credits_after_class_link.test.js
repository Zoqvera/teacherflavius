const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase/migrations/20261021143205_sync_unallocated_credits_after_class_link.sql'),
  'utf8'
);

test('class membership changes reconcile tuition that was paid first', () => {
  assert.match(migration, /after insert or update of class_number, user_id\s+on public\.class_students/i);
  assert.match(migration, /when \(new\.user_id is not null\)/i);
  assert.match(migration, /tuition\.student_id = new\.user_id/i);
  assert.match(migration, /tuition\.payment_date is not null or coalesce\(tuition\.is_exempt, false\)/i);
  assert.match(migration, /perform private\.sync_lesson_credits_for_tuition\(settled_tuition\.id\)/i);
});

test('only active covered billing cycles are eligible', () => {
  assert.match(migration, /settings\.active = true/i);
  assert.match(migration, /settings\.classes_per_month > 0/i);
  assert.match(migration, /private\.get_tuition_coverage_end\(tuition\.id\)/i);
  assert.match(migration, /at time zone 'America\/Sao_Paulo'/i);
});

test('never overwrite assigned or historically modified contractual lessons', () => {
  assert.match(migration, /and not exists \(/i);
  assert.match(migration, /credit\.credit_origin = 'contract'/i);
  assert.match(migration, /credit\.status is distinct from 'available'/i);
  for (const field of [
    'regular_class_number', 'regular_starts_at', 'regular_ends_at',
    'cancelled_at', 'makeup_booking_id', 'revoked_at'
  ]) {
    assert.match(migration, new RegExp('credit\\.' + field + ' is not null', 'i'));
  }
  assert.doesNotMatch(migration, /\bupdate\s+private\.lesson_credits\b/i);
  assert.doesNotMatch(migration, /\bupdate\s+public\.monthly_tuition\b/i);
});

test('trigger function is private, tightly scoped and not callable by students', () => {
  assert.match(migration, /create or replace function private\.sync_unallocated_credits_after_class_link\(\)/i);
  assert.match(migration, /set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.sync_unallocated_credits_after_class_link\(\)\s+from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute .* to authenticated/i);
});
