const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const migration = read("supabase/migrations/20261105134000_limit_student_cancellations_to_seven_days.sql");
const baseline = read("supabase/baseline/470_limit_student_cancellations_to_seven_days.sql");
const app = read("area-do-estudante/minhas-aulas/app.js");
const bookingEmail = read("supabase/functions/notify-makeup-booking/index.ts");
const notice = read("student_policy_notice_renderer.js");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("student cancellation opens exactly seven days before a regular lesson", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /evaluated_at >= target_starts_at - interval '7 days'/i);
    assert.match(sql, /evaluated_at < target_starts_at/i);
    assert.match(sql, /create or replace function private\.lesson_can_be_cancelled/i);
  }
  assert.match(migration, /cancellation_time < credit_row\.regular_starts_at - interval '7 days'/i);
  assert.match(migration, /cancellation_time < target_starts_at - interval '7 days'/i);
  assert.match(migration, /private\.lesson_can_be_cancelled\(candidate\.starts_at, now\(\)\)/i);
  assert.match(app, /MAX_CANCELLATION_LEAD_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(app, /isWithinCancellationWindow\(credit\.starts_at\)/);
});

test("replacement cancellation cannot be invoked by authenticated students", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /revoke execute on function public\.cancel_my_lesson_replacement\(uuid\)\s+from public, anon, authenticated/i);
    assert.match(sql, /revoke execute on function public\.cancel_my_makeup_class_booking\(uuid\)\s+from public, anon, authenticated/i);
  }
  assert.doesNotMatch(migration, /revoke execute on function public\.cancel_makeup_class_booking\(uuid\)/i);
  assert.match(migration, /when credit\.status = 'scheduled'\s+then private\.lesson_can_be_cancelled/i);
  assert.doesNotMatch(migration, /when credit\.status = 'used' and booking\.status = 'confirmed'\s+then private\.lesson_can_be_cancelled/i);
  assert.doesNotMatch(app, /replacement-cancel-button|rpc\("cancel_my_lesson_replacement"/);
});

test("existing 12-hour credit rule and no-cancellation messaging remain consistent", () => {
  assert.doesNotMatch(migration, /create or replace function private\.lesson_cancellation_grants_credit/i);
  assert.match(notice, /pelo menos 12 horas de antecedência/);
  assert.match(notice, /7 dias anteriores ao seu início/);
  assert.match(notice, /reposição já agendada não pode ser cancelada pelo aluno/);
  assert.match(bookingEmail, /Reposições confirmadas não podem ser canceladas pelo aluno/);
  assert.doesNotMatch(bookingEmail, /Você pode cancelar esta reposição até o início da aula/);
  assert.match(workflow, /470_limit_student_cancellations_to_seven_days\.sql/);
});

test("updated cancellation rules require a new versioned policy acknowledgement", () => {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /current_policy_version constant text := '2026-11-05-v2'/i);
    assert.match(sql, /create or replace function public\.get_my_required_student_policy_notice/i);
    assert.match(sql, /create or replace function public\.accept_my_student_policy_notice/i);
  }
  const loader = read("student_policy_notice_loader.js");
  const footer = read("site_footer_core.js");
  assert.match(loader, /student_policy_notice\.js\?v=20261105-v2/);
  assert.match(footer, /student_policy_notice_loader\.js\?v=20261105-v2/);
});
