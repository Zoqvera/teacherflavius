"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");

const requiredPhone = read("supabase/migrations/20261030021426_require_whatsapp_without_trial_phone_match.sql");
const monitor = read("supabase/migrations/20261030021534_class_waitlist_vacancy_email_monitor.sql");
const schedule = read("supabase/migrations/20261030021650_schedule_class_waitlist_vacancy_notifications.sql");
const retired = read("supabase/migrations/20261104024633_disable_class_seat_reservations.sql");
const discontinued = read("supabase/migrations/20261104031644_discontinue_class_waitlist_vacancy_emails.sql");
const edge = read("supabase/functions/notify-class-waitlist-vacancies/index.ts");
const chooseMarkup = read("escolher-turma/index.html");
const onboarding = read("complete-cadastro.html");
const availability = read("supabase/migrations/20261029224119_public_class_seat_holds.sql");

test("public seat registration is retired without weakening standard profile fields", () => {
  assert.match(chooseMarkup, /Reserva de turmas desativada/);
  assert.doesNotMatch(chooseMarkup, /id="studentPhone"|<script\b|<form\b/);
  assert.match(onboarding, /id="whatsapp"[^>]* required/);
  assert.match(requiredPhone, /private\.normalize_trial_phone\(target_whatsapp\) is null/);
  assert.match(requiredPhone, /private\.normalize_trial_phone\(new\.whatsapp\) is null/);
});

test("previous phone matching changes are historical and all intake endpoints are revoked", () => {
  assert.doesNotMatch(requiredPhone, /private\.is_recent_trial_phone\(normalized\)/);
  assert.match(retired, /revoke execute on function public\.create_public_class_seat_hold/);
  assert.match(retired, /revoke execute on function public\.join_public_class_seat_waitlist/);
  assert.match(retired, /create trigger reject_disabled_class_seat_waitlist/);
});

test("historical waitlist did not claim or reserve capacity", () => {
  assert.match(monitor, /from private\.class_seat_waitlist w/);
  assert.match(monitor, /w\.status='waiting'/);
  assert.doesNotMatch(monitor, /insert into private\.class_seat_holds/);
  assert.doesNotMatch(monitor, /insert into public\.class_students/);
  assert.match(availability, /private\.count_class_seat_holds/);
});

test("historical availability increases only enqueued protected contacts", () => {
  assert.match(monitor, /slot\.available_spots>previous\.available_spots/);
  assert.match(monitor, /unique\(class_number,event_number\)/);
  assert.match(monitor, /jsonb_agg\(jsonb_build_object/);
  assert.match(monitor, /create table private\.class_waitlist_vacancy_emails/);
  assert.match(monitor, /enable row level security/);
  assert.match(monitor, /revoke all on private\.class_waitlist_vacancy_emails from public,anon,authenticated/);
});

test("retired email endpoint rejects requests without sending messages", () => {
  assert.match(edge, /status: 410/);
  assert.match(edge, /Class waitlist vacancy emails are discontinued/);
  assert.doesNotMatch(edge, /fetch\(|createClient|RESEND_API_KEY|claim_class_waitlist_vacancy_emails_internal/);
});

test("discontinuation disables the legacy cron and queue permissions", () => {
  assert.match(discontinued, /cron\.unschedule\('class-waitlist-vacancy-email-every-minute'\)/);
  assert.match(discontinued, /REVOKE EXECUTE ON FUNCTION public\.claim_class_waitlist_vacancy_emails_internal\(integer\)/);
  assert.match(discontinued, /REVOKE EXECUTE ON FUNCTION public\.finish_class_waitlist_vacancy_email_internal\(uuid,text,text,text\)/);
  assert.doesNotMatch(discontinued, /DELETE FROM|TRUNCATE|DROP TABLE/i);
});

test("the previously scheduled minute-by-minute monitor is now unscheduled", () => {
  assert.match(schedule, /'\* \* \* \* \*'/);
  assert.match(schedule, /private\.run_class_waitlist_vacancy_monitor/);
  assert.match(retired, /cron\.unschedule\('class-waitlist-vacancy-email-every-minute'\)/);
  assert.match(monitor, /n\.attempts<5/);
  assert.match(monitor, /for update skip locked/);
  assert.match(monitor, /last_error/);
});
