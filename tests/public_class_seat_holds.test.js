const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function source(name) {
  return fs.readFileSync(path.join(__dirname, "..", name), "utf8");
}

const migration = source("supabase/migrations/20261029224119_public_class_seat_holds.sql");
const publicHtml = source("escolher-turma/index.html");
const publicApp = source("escolher-turma/app.js");
const adminHtml = source("reservas-de-turmas/index.html");
const adminApp = source("reservas-de-turmas/app.js");

test("15-minute holds use the membership lock and count as occupied capacity", () => {
  assert.match(migration, /expiry := now\(\)\+interval '15 minutes'/);
  assert.match(migration, /pg_advisory_xact_lock\(73008,target_class_number\)/);
  assert.match(migration, /pg_advisory_xact_lock\(73008,new\.class_number\)/);
  assert.match(migration, /private\.count_class_seat_holds\(target_class_number\)/);
  assert.match(migration, /current_count \+ private\.count_class_seat_holds\(new\.class_number,excluded_phone\) >= capacity/);
  assert.match(migration, /create trigger zz_guard_class_seat_holds_on_membership/);
  assert.match(migration, /create trigger zz_claim_class_seat_hold_on_membership/);
});

test("trial attendees must match registered WhatsApp digits and have limited holds", () => {
  assert.match(migration, /trial\.whatsapp_digits='55'\|\|target_phone/);
  assert.match(migration, /trial\.status in \('scheduled','completed'\)/);
  assert.match(migration, /count\(\*\) from private\.class_seat_holds[\s\S]*created_at>now\(\)-interval '24 hours'/);
  assert.match(migration, /class_seat_holds_one_active_phone/);
  assert.match(migration, /extensions\.digest\(secret,'sha256'\)/);
});

test("private contact data stays inaccessible to browser roles", () => {
  assert.match(migration, /create table private\.class_seat_holds/);
  assert.match(migration, /create table private\.class_seat_waitlist/);
  assert.match(migration, /alter table private\.class_seat_holds enable row level security/);
  assert.match(migration, /alter table private\.class_seat_waitlist enable row level security/);
  assert.match(migration, /revoke all on private\.class_seat_holds from public, anon, authenticated/);
  assert.match(migration, /revoke all on private\.class_seat_waitlist from public, anon, authenticated/);
  assert.match(migration, /if not coalesce\(public\.is_teacher_admin\(\),false\)/);
  assert.match(migration, /grant execute on function public\.get_teacher_class_seat_leads\(\) to authenticated,service_role/);
});

test("public pages are unindexed and contain neither contact data nor external styles", () => {
  assert.match(publicHtml, /content="noindex,nofollow"/);
  assert.match(adminHtml, /content="noindex,nofollow"/);
  assert.doesNotMatch(publicHtml, /\bonline\b/i);
  assert.doesNotMatch(publicApp, /\bonline\b/i);
  assert.match(publicApp, /get_public_class_seat_availability/);
  assert.match(publicApp, /create_public_class_seat_hold/);
  assert.match(publicApp, /join_public_class_seat_waitlist/);
  assert.match(publicApp, /REFRESH_INTERVAL_MS = 10000/);
  assert.match(publicApp, /get_public_class_seat_hold/);
  assert.match(publicApp, /cancel_public_class_seat_hold/);
});

test("teacher has a separate screen for active holds and waitlist", () => {
  assert.match(adminApp, /get_teacher_class_seat_leads/);
  assert.match(adminApp, /resolve_teacher_class_seat_lead/);
  assert.match(adminApp, /is_teacher_admin/);
  assert.match(source("professor_home.js"), /href: "\/reservas-de-turmas\/"/);
  assert.match(source("professor/professor_icons.js"), /'reservas-de-turmas': '<svg/);
  assert.match(source("reservas-de-vagas/index.html"), /href="\/reservas-de-turmas\/"/);
  assert.match(adminApp, /PUBLIC_LINK = "https:\/\/teacherflavius\.com\/escolher-turma\/"/);
});

test("promotional-price reservations remain separate from class-seat holds", () => {
  assert.match(source("reservas-de-vagas/index.html"), /Não bloqueia vaga nem horário em turmas/);
  assert.doesNotMatch(migration, /update public\.monthly_tuition/i);
  assert.doesNotMatch(migration, /update public\.student_billing_settings/i);
});

const optionalPhoneMigration = source("supabase/migrations/20261030004428_optional_whatsapp_class_seats.sql");

test("phone field is optional, with a persisted browser key and explicit student association", () => {
  assert.match(publicHtml.replace(/placeholder="\(34\) 99999-9999"/, ""), /WhatsApp com DDD \(opcional\)/);
  assert.doesNotMatch(publicHtml, /id="studentPhone"[^>]*\srequired/);
  assert.match(publicApp, /CLIENT_KEY_STORAGE_KEY/);
  assert.match(publicApp, /getClientKey\(\)/);
  assert.match(publicApp, /target_client_key: clientKey/);
  assert.doesNotMatch(publicApp, /if \(!name \|\| !whatsapp\) return/);
  assert.match(optionalPhoneMigration, /alter table private\.class_seat_holds alter column whatsapp drop not null/);
  assert.match(optionalPhoneMigration, /alter table private\.class_seat_waitlist alter column whatsapp drop not null/);
  assert.match(optionalPhoneMigration, /'device:' \|\| encode\(extensions\.digest\(target_client_key,'sha256'\),'hex'\)/);
  assert.match(optionalPhoneMigration, /status='active' and h\.expires_at>now\(\)/);
});

test("legacy three-argument RPCs stay intact for open browser tabs", () => {
  assert.match(optionalPhoneMigration, /create function public\.create_public_class_seat_hold\(\s*target_class_number integer,\s*target_name text,\s*target_whatsapp text,\s*target_client_key text/);
  assert.match(optionalPhoneMigration, /create function public\.join_public_class_seat_waitlist\(\s*target_class_number integer,\s*target_name text,\s*target_whatsapp text,\s*target_client_key text/);
  assert.doesNotMatch(optionalPhoneMigration, /drop function.*public\.create_public_class_seat_hold/i);
});

test("the teacher can associate holds without bypassing enrollment rules", () => {
  assert.match(optionalPhoneMigration, /create function public\.assign_teacher_class_seat_hold/);
  assert.match(optionalPhoneMigration, /if not coalesce\(public\.is_teacher_admin\(\),false\)/);
  assert.match(optionalPhoneMigration, /student_id=new\.user_id/);
  assert.match(optionalPhoneMigration, /student_id=target_student_id/);
  assert.match(adminApp, /assign_teacher_class_seat_hold/);
  assert.match(adminApp, /get_teacher_students/);
  assert.match(adminApp, /ASSOCIAR AO ALUNO/);
  assert.match(adminApp, /if \(lead\.whatsapp\) actions\.append\(phoneLink\(lead\.whatsapp\)\)/);
});

test("phone-less waiting-list requests explain how to follow up", () => {
  assert.match(publicApp, /Informe seu nome e a turma ao professor pelo WhatsApp/);
  assert.match(optionalPhoneMigration, /on conflict \(class_number,normalized_phone\) do update/);
});

const selfEnrollmentMigration = source("supabase/migrations/20261030011157_reserved_seat_self_enrollment.sql");
const enrollmentHtml = source("complete-cadastro.html");

test("reserved seat exposes transparent monthly fee from an existing teacher plan", () => {
  assert.match(selfEnrollmentMigration, /create table private\.class_seat_enrollment_settings/);
  assert.match(selfEnrollmentMigration, /link\.monthly_fee=50 and link\.classes_per_month=4/);
  assert.match(selfEnrollmentMigration, /create function public\.get_public_class_seat_enrollment_plan/);
  assert.match(selfEnrollmentMigration, /where settings\.singleton and link\.active and link\.class_mode='group'/);
  assert.match(publicApp, /get_public_class_seat_enrollment_plan/);
  assert.match(publicApp, /enrollmentPlan/);
  assert.match(publicHtml, /id="planSummary"/);
});

test("public reservation advances to Google onboarding without exposing its capability token", () => {
  assert.match(publicHtml, /href="\/complete-cadastro\/"/);
  assert.match(publicHtml, /CONTINUAR PARA MATRÍCULA/);
  assert.match(publicApp, /saveHold\(Object\.assign/);
  assert.match(enrollmentHtml, /CLASS_SEAT_STORAGE_KEY = "teacherflavius_class_seat_hold_v1"/);
  assert.match(enrollmentHtml, /authorize_my_reserved_seat_enrollment/);
  assert.match(enrollmentHtml, /complete_my_reserved_seat_enrollment/);
  assert.doesNotMatch(publicHtml, /reserva=[0-9a-f]+/i);
});

test("first lesson and acquisition origin are mandatory in self-service enrollment", () => {
  assert.match(enrollmentHtml, /Em que dia será sua primeira aula/);
  assert.match(enrollmentHtml, /target_first_lesson_date: firstLessonDate/);
  assert.match(enrollmentHtml, /target_source: answer\.source/);
  assert.match(selfEnrollmentMigration, /perform public\.set_my_student_acquisition/);
  assert.match(selfEnrollmentMigration, /extract\(isodow from target_first_lesson_date\)/);
  assert.match(selfEnrollmentMigration, /first_lesson_date\)\s*values\(hold\.class_number,requester,target_first_lesson_date\)/);
});

test("completion is atomic, authorized and does not bypass the billing workflow", () => {
  assert.match(selfEnrollmentMigration, /if hold\.status<>'active' or hold\.expires_at<=now\(\)/);
  assert.match(selfEnrollmentMigration, /hold\.student_id is distinct from requester/);
  assert.match(selfEnrollmentMigration, /perform pg_catalog\.pg_advisory_xact_lock\(73008,hold\.class_number\)/);
  assert.match(selfEnrollmentMigration, /perform public\.set_my_enrollment_class_mode\('group'\)/);
  assert.match(selfEnrollmentMigration, /perform public\.set_my_enrollment_billing_terms\(\)/);
  assert.match(selfEnrollmentMigration, /profile_completed=true/);
  assert.match(selfEnrollmentMigration, /insert into public\.class_students/);
  assert.match(selfEnrollmentMigration, /grant execute on function public\.complete_my_reserved_seat_enrollment/);
  assert.doesNotMatch(selfEnrollmentMigration, /grant execute on function public\.complete_my_reserved_seat_enrollment[\s\S]*?to anon/);
  assert.match(enrollmentHtml, /clearReservedSeat\(\);\s*window\.location\.replace\(getPostEnrollmentPath\(\)\)/);
});

test("the original enrollment access-code path remains available", () => {
  assert.match(enrollmentHtml, /authorize_my_enrollment/);
  assert.match(enrollmentHtml, /state = await applyInvitation\(state\)/);
  assert.match(enrollmentHtml, /state = await applyReservedSeat\(state\)/);
  assert.match(enrollmentHtml, /await Auth\.completeProfile/);
  assert.match(enrollmentHtml, /set_my_student_acquisition/);
});

const seatActivationGuard = source("supabase/migrations/20261030011708_guard_reserved_seat_activation.sql");

test("an enrollment authorized by a reservation cannot fall back to ordinary signup", () => {
  assert.match(seatActivationGuard, /add column reserved_seat_hold_id uuid/);
  assert.match(seatActivationGuard, /create trigger zz_guard_reserved_seat_profile_activation/);
  assert.match(seatActivationGuard, /current_setting\('teacherflavius\.reserved_seat_completion',true\)/);
  assert.match(seatActivationGuard, /h\.status='active' and h\.expires_at>now\(\)/);
  assert.match(seatActivationGuard, /reserved_seat_hold_id=hold\.id/);
  assert.match(seatActivationGuard, /pg_catalog\.set_config\('teacherflavius\.reserved_seat_completion'/);
  assert.match(enrollmentHtml, /id="reservedSeatError"/);
  assert.match(enrollmentHtml, /VOLTAR E ESCOLHER UMA TURMA/);
});

const optionalEnrollmentPhoneMigration = source(
  "supabase/migrations/20261030012238_optional_whatsapp_reserved_seat_enrollment.sql"
);

test("reserved-seat enrollment accepts a missing WhatsApp without relaxing legacy enrollment", () => {
  assert.match(enrollmentHtml, /whatsappInput\.required = !hasSeat/);
  assert.match(enrollmentHtml, /WhatsApp \(opcional\)/);
  assert.match(optionalEnrollmentPhoneMigration, /length\(phone_digits\)<>0 and length\(phone_digits\) not between 10 and 13/);
  assert.match(optionalEnrollmentPhoneMigration, /hold\.status = 'active'/);
  assert.match(optionalEnrollmentPhoneMigration, /hold\.expires_at > now\(\)/);
  assert.match(optionalEnrollmentPhoneMigration, /current_setting\('teacherflavius\.reserved_seat_completion', true\) = hold\.id::text/);
  assert.match(optionalEnrollmentPhoneMigration, /whatsapp=nullif\(btrim\(target_whatsapp\),''\)/);
  assert.match(optionalEnrollmentPhoneMigration, /raise exception 'Informe um WhatsApp válido para concluir a matrícula\.'/);
});
