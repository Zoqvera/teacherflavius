const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const migration = read("supabase/migrations/20261015030100_add_regular_and_teacher_cancellation_email_notifications.sql");
const regular = read("supabase/functions/notify-regular-lesson-cancellation/index.ts");
const makeup = read("supabase/functions/notify-makeup-booking/index.ts");

test("regular cancellation queue is private to service role and deduplicated per recipient", () => {
  assert.match(migration, /create table if not exists public\.regular_lesson_cancellation_email_notifications/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.regular_lesson_cancellation_email_notifications from public, anon, authenticated/i);
  assert.match(migration, /recipient_type in \('student', 'teacher'\)/);
  assert.match(migration, /unique \(credit_id, cancelled_at, recipient_type\)/);
  assert.match(migration, /from \(values \('student'::text\), \('teacher'::text\)\)/);
  assert.match(migration, /on conflict \(credit_id, cancelled_at, recipient_type\) do nothing/i);
});

test("regular cancellation is queued only after a real credit status transition", () => {
  assert.match(migration, /after update of status, cancelled_at on private\.lesson_credits/i);
  assert.match(migration, /old\.status = 'scheduled'/);
  assert.match(migration, /new\.status in \('available', 'forfeited'\)/);
  assert.match(migration, /new\.cancelled_at is not null/);
  assert.match(migration, /old\.cancelled_at is distinct from new\.cancelled_at/);
  assert.match(migration, /new\.regular_starts_at is not null/);
  assert.match(migration, /new\.status = 'available'/);
  assert.doesNotMatch(migration, /create or replace function public\.cancel_my_regular_lesson/i);
});

test("regular notification webhook uses stored secret and non-public trigger functions", () => {
  assert.match(migration, /vault\.decrypted_secrets/);
  assert.match(migration, /teacherflavius_notification_webhook_secret/);
  assert.match(migration, /net\.http_post\(/);
  assert.match(migration, /notify-regular-lesson-cancellation/);
  assert.match(migration, /security definer\s+set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.dispatch_regular_lesson_cancellation_email\(\)/i);
});

test("regular cancellation emails use distinct idempotency keys and verified student email", () => {
  assert.match(regular, /Teacher Flávio <contato@teacherflavius\.com>/);
  assert.match(regular, /const TEACHER_EMAIL = "contato@teacherflavius\.com"/);
  assert.match(regular, /auth\.admin\.getUserById\(notice\.student_id\)/);
  assert.match(regular, /studentAuth\?\.user\?\.email/);
  assert.match(regular, /Idempotency-Key/);
  assert.match(regular, /regular-cancellation-\$\{notice\.recipient_type\}-\$\{notice\.id\}/);
  assert.match(regular, /notice\.status === "sent"/);
  assert.match(regular, /recipient_type === "teacher"/);
  assert.match(regular, /status: "failed"/);
  assert.match(regular, /status: "sent"/);
  assert.doesNotMatch(regular, /user_metadata|raw_user_meta_data/);
});

test("credit explanation matches eligible and forfeited cancellation statuses", () => {
  assert.match(regular, /notification\.credit_granted/);
  assert.match(regular, /com pelo menos 12 horas de antecedência/);
  assert.match(regular, /com menos de 12 horas de antecedência/);
  assert.match(regular, /não foi concedido crédito de reposição/);
});

test("makeup cancellations queue a separate teacher notice without changing student notice", () => {
  assert.match(migration, /'teacher_cancellation'/);
  assert.match(migration, /when \(new\.notification_type = 'cancellation'\)/);
  assert.match(migration, /on conflict \(booking_id, notification_type\) do nothing/);
  assert.match(makeup, /TEACHER_CANCELLATION_TYPE = "teacher_cancellation"/);
  assert.match(makeup, /const isTeacherCancellation = notificationType === TEACHER_CANCELLATION_TYPE/);
  assert.match(makeup, /isTeacherBooking \|\| isTeacherCancellation/);
  assert.match(makeup, /isTeacherNotice \? teacherEmail : booking\.student_email/);
  assert.match(makeup, /Reposição cancelada: \$\{studentName\}/);
  assert.match(makeup, /remova-o manualmente/);
  assert.match(makeup, /else if \(isCancellation\)/);
  assert.match(makeup, /Reposição de aula cancelada/);
});
