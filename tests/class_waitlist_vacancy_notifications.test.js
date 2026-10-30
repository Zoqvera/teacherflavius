"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const requiredPhone = read("supabase/migrations/20261030021426_require_whatsapp_without_trial_phone_match.sql");
const monitor = read("supabase/migrations/20261030021534_class_waitlist_vacancy_email_monitor.sql");
const schedule = read("supabase/migrations/20261030021650_schedule_class_waitlist_vacancy_notifications.sql");
const edge = read("supabase/functions/notify-class-waitlist-vacancies/index.ts");
const chooseMarkup = read("escolher-turma/index.html");
const chooseApp = read("escolher-turma/app.js");
const onboarding = read("complete-cadastro.html");
const availability = read("supabase/migrations/20261029224119_public_class_seat_holds.sql");

test("every student-facing reservation, waitlist, and enrollment requires WhatsApp", () => {
  assert.match(chooseMarkup, /id="studentPhone"[^>]* required/);
  assert.match(chooseMarkup, /WhatsApp com DDD \(obrigatório\)/);
  assert.match(chooseApp, /if \(!name \|\| !isValidWhatsapp\(whatsapp\)\)/);
  assert.match(onboarding, /whatsappInput\.required = true/);
  assert.match(onboarding, /"WhatsApp \(obrigatório\)"/);
  assert.match(requiredPhone, /private\.normalize_trial_phone\(target_whatsapp\) is null/);
  assert.match(requiredPhone, /private\.normalize_trial_phone\(new\.whatsapp\) is null/);
});

test("trial phone is never used as an eligibility comparison in live enrollment RPCs", () => {
  assert.doesNotMatch(requiredPhone, /private\.is_recent_trial_phone\(normalized\)/);
  assert.match(chooseMarkup, /diferente do número usado para agendar a aula experimental/);
  assert.match(onboarding, /diferente do usado na aula experimental/);
});

test("waitlist cannot claim or reserve capacity", () => {
  assert.match(monitor, /from private\.class_seat_waitlist w/);
  assert.match(monitor, /w\.status='waiting'/);
  assert.doesNotMatch(monitor, /insert into private\.class_seat_holds/);
  assert.doesNotMatch(monitor, /insert into public\.class_students/);
  assert.match(availability, /private\.count_class_seat_holds/);
});

test("only increases in available spots create queue events with protected contacts", () => {
  assert.match(monitor, /slot\.available_spots>previous\.available_spots/);
  assert.match(monitor, /unique\(class_number,event_number\)/);
  assert.match(monitor, /jsonb_agg\(jsonb_build_object/);
  assert.match(monitor, /create table private\.class_waitlist_vacancy_emails/);
  assert.match(monitor, /enable row level security/);
  assert.match(monitor, /revoke all on private\.class_waitlist_vacancy_emails from public,anon,authenticated/);
});

test("email worker is authenticated and sends contact links only to teacher", () => {
  assert.match(edge, /RECIPIENT = "contato@teacherflavius\.com"/);
  assert.match(edge, /"Idempotency-Key": "class-waitlist-" \+ notification\.notification_id/);
  assert.match(edge, /href="https:\/\/wa\.me\/' \+ number/);
  assert.match(edge, /x-webhook-secret/);
  assert.match(edge, /equalSecrets/);
  assert.match(edge, /claim_class_waitlist_vacancy_emails_internal/);
  assert.match(monitor, /grant execute on function public\.claim_class_waitlist_vacancy_emails_internal\(integer\)\s+to service_role/);
  assert.match(monitor, /grant execute on function public\.finish_class_waitlist_vacancy_email_internal\(uuid,text,text,text\)\s+to service_role/);
});

test("monitor runs every minute, retries failures, and respects provider idempotency", () => {
  assert.match(schedule, /'\* \* \* \* \*'/);
  assert.match(schedule, /private\.run_class_waitlist_vacancy_monitor/);
  assert.match(monitor, /n\.attempts<5/);
  assert.match(monitor, /for update skip locked/);
  assert.match(monitor, /last_error/);
});
