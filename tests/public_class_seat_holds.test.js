"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const retired = source("supabase/migrations/20261104024633_disable_class_seat_reservations.sql");
const initial = source("supabase/migrations/20261029224119_public_class_seat_holds.sql");
const chooser = source("escolher-turma/index.html");
const teacherPage = source("reservas-de-turmas/index.html");
const onboarding = source("complete-cadastro.html");
const professorHome = source("professor_home.js");
const promotionsPage = source("reservas-de-vagas/index.html");

test("old reservations remain historical and are no longer exposed through a page", () => {
  assert.match(initial, /create table private\.class_seat_holds/);
  assert.match(initial, /create table private\.class_seat_waitlist/);
  assert.match(chooser, /Reserva de turmas desativada/);
  assert.match(chooser, /Nenhuma vaga pode ser reservada por esta página/);
  assert.match(teacherPage, /Reservas de turmas desativadas/);
  assert.match(chooser, /content="noindex,nofollow"/);
  assert.match(teacherPage, /content="noindex,nofollow"/);
  assert.doesNotMatch(chooser, /<form\b|id="leadForm"|<script\b|\/escolher-turma\/app\.js/);
  assert.doesNotMatch(teacherPage, /<script\b|id="holds"|id="waitlist"/);
  assert.doesNotMatch(chooser, /\bonline\b/i);
});

test("the database denies new reservations and waiting-list records at insertion", () => {
  assert.match(retired, /create function private\.reject_disabled_class_seat_reservation/);
  assert.match(retired, /create trigger reject_disabled_class_seat_hold/);
  assert.match(retired, /create trigger reject_disabled_class_seat_waitlist/);
  assert.match(retired, /raise exception 'A reserva de turmas foi desativada/);
});

test("every browser booking and self-enrollment endpoint is revoked, including legacy overloads", () => {
  for (const signature of [
    "create_public_class_seat_hold\\(integer,text,text\\)",
    "create_public_class_seat_hold\\(integer,text,text,text\\)",
    "join_public_class_seat_waitlist\\(integer,text,text\\)",
    "join_public_class_seat_waitlist\\(integer,text,text,text\\)",
    "authorize_my_reserved_seat_enrollment\\(text\\)",
    "get_public_class_seat_hold\\(text\\)",
    "get_public_class_seat_enrollment_plan\\(\\)",
    "complete_my_reserved_seat_enrollment\\(",
    "start_my_reserved_seat_checkout\\(\\)",
    "assign_teacher_class_seat_hold\\(uuid,uuid\\)",
    "get_teacher_class_seat_leads\\(\\)",
    "resolve_teacher_class_seat_lead\\(uuid,text\\)"
  ]) {
    assert.match(retired, new RegExp("revoke execute on function public\\." + signature));
  }
  assert.match(retired, /from public,anon,authenticated,service_role/);
});

test("specific hooks and schedules are disabled without changing normal billing", () => {
  for (const name of [
    "zz_claim_class_seat_hold_on_membership",
    "zz_guard_class_seat_holds_on_membership",
    "zzz_track_reserved_seat_payment_window",
    "zz_guard_reserved_seat_profile_activation"
  ]) {
    assert.match(retired, new RegExp("disable trigger " + name));
  }
  assert.match(retired, /cron\.unschedule\('class-waitlist-vacancy-email-every-minute'\)/);
  assert.match(retired, /cron\.unschedule\('reserved-seat-first-payment-expiration'\)/);
  assert.doesNotMatch(retired, /delete from public\.|truncate |drop table/i);
  assert.doesNotMatch(retired, /update public\.monthly_tuition|update public\.profiles|update public\.student_billing_settings/i);
});

test("teacher dashboard hides the old shortcut but promotional reservations are preserved", () => {
  assert.match(professorHome, /"reservas-de-turmas"/);
  assert.doesNotMatch(professorHome, /href: "\/reservas-de-turmas\/"/);
  assert.doesNotMatch(promotionsPage, /href="\/reservas-de-turmas\/"/);
  assert.match(promotionsPage, /Nova reserva promocional/);
  assert.match(promotionsPage, /Não bloqueia vaga nem horário em turmas/);
});

test("normal enrollment uses invitations rather than the discontinued chooser", () => {
  assert.match(onboarding, /authorize_my_enrollment_link/);
  assert.match(onboarding, /requiresEnrollmentInvitation\(state\)/);
  assert.match(onboarding, /link de convite para realizar a matrícula/);
  assert.match(onboarding, /await Auth\.completeProfile/);
  assert.match(onboarding, /getPostEnrollmentPath\(\)/);
  assert.doesNotMatch(onboarding, /authorize_my_reserved_seat_enrollment/);
  assert.doesNotMatch(onboarding, /complete_my_reserved_seat_enrollment/);
  assert.doesNotMatch(onboarding, /CLASS_SELECTION_PATH/);
});

test("public read-only availability remains available without the retired reservations feature", () => {
  assert.match(initial, /create function public\.get_public_class_seat_availability/);
  assert.doesNotMatch(retired, /revoke execute on function public\.get_public_class_seat_availability/);
});

test("legacy scripts are no longer loaded by retired pages", () => {
  assert.match(source("escolher-turma/app.js"), /create_public_class_seat_hold/);
  assert.match(source("reservas-de-turmas/app.js"), /get_teacher_class_seat_leads/);
  assert.doesNotMatch(chooser, /\/escolher-turma\/app\.js/);
  assert.doesNotMatch(teacherPage, /\/reservas-de-turmas\/app\.js/);
});

test("the unused throttling proposal is retired without applying a migration", () => {
  const docs = source("docs/security-public-seat-budgets-20261104.md");
  assert.match(docs, /nunca foi aplicada em produção/);
  assert.match(docs, /20261104024633_disable_class_seat_reservations/);
  assert.equal(
    fs.existsSync(path.join(__dirname, "..",
      "supabase/migrations/20261104024500_throttle_public_class_seat_submission_attempts.sql")),
    false
  );
});
