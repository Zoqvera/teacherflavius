const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

const migration = read(
  "supabase/migrations/20261022153000_pedagogical_preparation_alerts.sql",
);
const sender = read(
  "supabase/functions/notify-pedagogical-preparation/index.ts",
);

test("only active, enrolled students with a previously recorded session qualify", () => {
  assert.match(migration, /student\.enrolled is true/i);
  assert.match(migration, /student\.archived is false/i);
  assert.match(migration, /previous_lesson\.starts_at is not null/i);
  assert.match(migration, /student_regular_lesson_cancellations/i);
  assert.match(migration, /student_regular_lesson_restorations/i);
});

test("both pedagogical signals are independent and use canonical records", () => {
  assert.match(migration, /private\.academic_next_lesson_number/i);
  assert.match(migration, /public\.lesson_presentations/i);
  assert.match(migration, /nullif\(btrim\(presentation\.body\), ''\)/i);
  assert.match(migration, /private\.student_question_studies/i);
  assert.match(migration, /studied\.studied_at > previous_lesson\.starts_at/i);
  assert.match(migration, /lesson_without_text or candidate\.no_questions_studied/i);
});

test("alerts are sent once per class session with a buffer of six hours", () => {
  assert.match(migration, /unique \(class_number, starts_at\)/i);
  assert.match(migration, /on conflict \(class_number, starts_at\) do nothing/i);
  assert.match(migration, /interval '6 hours 40 minutes'/i);
  assert.match(migration, /interval '6 hours'/i);
  assert.match(migration, /'pedagogical-preparation-alerts'/i);
  assert.match(sender, /SIX_HOURS_MS = 6 \* 60 \* 60 \* 1000/);
});

test("outbox is private to the service role and never stores contact details", () => {
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table public\.pedagogical_preparation_alerts from public, anon, authenticated/i);
  assert.match(migration, /grant select, update on table public\.pedagogical_preparation_alerts to service_role/i);
  assert.doesNotMatch(migration, /students[^;]*whatsapp/i);
});

test("the email is only sent to the professor with the exact requested subject", () => {
  assert.match(sender, /pedagogico@teacherflavius\.com/);
  assert.match(sender, /TO_EMAIL = "contato@teacherflavius\.com"/);
  assert.match(sender, /SUBJECT = "Acompanhamento pedagógico"/);
  assert.match(sender, /to: \[TO_EMAIL\]/);
  assert.match(sender, /"Lição " \+ student\.pending\.lesson_number \+ " sem texto"/);
  assert.match(sender, /"Nenhuma pergunta estudada"/);
  assert.match(sender, /Idempotency-Key/);
  assert.match(sender, /ENROLLMENT_WEBHOOK_SECRET/);
});
