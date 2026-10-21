const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.join(__dirname, '..', 'supabase/migrations/20261021203500_prevent_cross_cycle_lesson_duplicates.sql'), 'utf8');

test('contractual allocation can reach the fourth weekly lesson beyond the invoice boundary', () => {
  assert.match(sql, /create or replace function private\.sync_lesson_credits_for_tuition\(/i);
  assert.match(sql, /\(coverage_start \+ 180\)::timestamp/i);
  assert.doesNotMatch(sql, /\(coverage_end - 1\)::timestamp/i);
});

test('subsequent invoices must skip lessons already assigned to older tuition', () => {
  assert.match(sql, /earlier_credit\.regular_starts_at\s*=\s*\(\(lesson_day::date/i);
  assert.match(sql, /earlier_credit\.regular_class_number = class\.class_number/i);
  assert.match(sql, /earlier_tuition\.due_date < tuition_row\.due_date/i);
  assert.match(sql, /earlier_tuition\.reference_month < tuition_row\.reference_month/i);
  assert.match(sql, /earlier_credit\.revoked_at is null/i);
});

test('paid lessons remain visible after the next due date and never become unpaid predictions', () => {
  assert.match(sql, /credit\.status = 'scheduled'\s+and credit\.regular_starts_at > now\(\)/i);
  assert.match(sql, /paid_credit\.regular_starts_at = occurrence\.starts_at/i);
  assert.match(sql, /paid_credit\.status in \('scheduled', 'used'\)/i);
  assert.match(sql, /public\.get_my_lesson_forecast\(\)/i);
});

test('preserve privileged function boundaries and do not grant replacements to clients', () => {
  assert.equal((sql.match(/security definer/gi) || []).length, 3);
  assert.equal((sql.match(/set search_path to ''/gi) || []).length, 3);
  assert.doesNotMatch(sql, /grant\s+execute/i);
});

test('weekly first and next contract blocks do not overlap', () => {
  const first = ['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14'];
  const afterNextDue = ['2026-11-14', '2026-11-21', '2026-11-28', '2026-12-05', '2026-12-12'];
  const next = afterNextDue.filter(day => !first.includes(day)).slice(0, 4);
  assert.deepEqual(next, ['2026-11-21', '2026-11-28', '2026-12-05', '2026-12-12']);
  assert.equal(new Set(first.concat(next)).size, 8);
});
