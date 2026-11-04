const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261104032714_student_preparation_email_reminders.sql"),
  "utf8",
);
const sender = fs.readFileSync(
  path.join(root, "supabase/functions/notify-student-preparation/index.ts"),
  "utf8",
);

test("student reminders have an independent, service-only outbox and disabled-by-default switch", () => {
  assert.match(migration, /create table if not exists public\.student_preparation_email_reminders/i);
  assert.match(migration, /create table if not exists public\.student_preparation_email_settings/i);
  assert.match(migration, /enabled boolean not null default false/i);
  assert.match(migration, /unique \(student_id, class_number, starts_at\)/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on public\.student_preparation_email_reminders from public, anon, authenticated/i);
  assert.match(migration, /revoke all on public\.student_preparation_email_settings from public, anon, authenticated/i);
  assert.match(sender, /\.from\("student_preparation_email_settings"\)/);
});

test("precise eligibility, attendance, cancellation and academic signals", () => {
  assert.match(migration, /student\.enrolled is true/i);
  assert.match(migration, /student\.archived is false/i);
  assert.match(migration, /membership\.first_lesson_date/i);
  assert.match(migration, /student_regular_lesson_cancellations/i);
  assert.match(migration, /student_regular_lesson_restorations/i);
  assert.match(migration, /academic_next_lesson_number/i);
  assert.match(migration, /lesson_presentations/i);
  assert.match(migration, /nullif\(btrim\(presentation\.body\), ''\) is not null/i);
  assert.match(migration, /count\(distinct studies\.question_id\)/i);
  assert.match(migration, /studied\.?count < 5|progress\.studied_count < 5/i);
  assert.match(migration, /attend.*in \('present','absent'\)/is);
  assert.match(migration, /context\.missing_presentation or context\.missing_questions/i);
});

test("schedule is one day ahead at 18:00 Sao Paulo time and runs safely on retry", () => {
  assert.match(migration, /local_now::date \+ 1/i);
  assert.match(migration, /time '18:00'/i);
  assert.match(migration, /'student-preparation-email-reminders'/);
  assert.match(migration, /'\\*\/5 \* \* \* \*'|'\*\/5 \* \* \* \*'/);
  assert.match(migration, /on conflict \(student_id,class_number,starts_at\) do nothing/i);
  assert.match(sender, /localDate\(reminder\.starts_at\) !== nextDate/);
});

test("send only to one student, with only their remaining tasks", () => {
  assert.match(sender, /pedagogico@teacherflavius\.com/);
  assert.match(sender, /to: \[student\.student_email\]/);
  assert.match(sender, /STUDY_TARGET = 5/);
  assert.match(sender, /if \(context\.missing_presentation/);
  assert.match(sender, /if \(context\.missing_questions\)/);
  assert.match(sender, /student_preparation_email_context_internal/);
  assert.match(sender, /already_prepared_or_not_eligible/);
  assert.match(sender, /Idempotency-Key/);
  assert.doesNotMatch(sender, /to: \[REPLY_TO\]/);
});

test("worker requires shared secret and persists statuses without exposing email in outbox", () => {
  assert.match(sender, /ENROLLMENT_WEBHOOK_SECRET/);
  assert.match(sender, /request\.headers\.get\("x-webhook-secret"\)/);
  assert.match(sender, /Idempotency-Key/);
  assert.match(migration, /'processing','sent','failed','skipped'/i);
  assert.doesNotMatch(
    migration.match(/create table if not exists public\.student_preparation_email_reminders\s*\(([\s\S]*?)\);/i)?.[1] || "",
    /student_email|student_name|body text|question_content/i,
  );
});
