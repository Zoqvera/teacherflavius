"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = filename => fs.readFileSync(path.join(root, filename), "utf8");
const reservationService = require("../reservas-de-vagas/reservations.js");

const migration = read("supabase/migrations/20261010014934_promotional_price_reservations.sql");
const validation = read("supabase/migrations/20261010015121_validate_promotional_reservation_slots.sql");
const page = read("reservas-de-vagas/index.html");
const script = read("reservas-de-vagas/reservations.js");

test("Brazilian WhatsApp matching strips country code and validates DDD", () => {
  assert.equal(reservationService.normalizePhone("(16) 99999-9999"), "16999999999");
  assert.equal(reservationService.normalizePhone("+55 (16) 99999-9999"), "16999999999");
  assert.equal(reservationService.normalizePhone("16 9999-9999"), "1699999999");
  assert.equal(reservationService.normalizePhone("123"), null);
  assert.equal(reservationService.normalizePhone(""), null);
});

test("availability labels preserve weekday and clock time", () => {
  assert.equal(reservationService.labelSlot("qua|20:00"), "Quarta 20:00");
  assert.equal(reservationService.labelSlot("seg|09:00"), "Segunda 09:00");
});

test("promotion reservations stay separate from seats, enrolled students and tuition history", () => {
  assert.match(migration, /create table private\.promotion_reservations/i);
  assert.match(migration, /promotional_tuition numeric\(10,2\)/i);
  assert.match(migration, /payment_disposition text/i);
  assert.match(migration, /linked_trial_id uuid/i);
  assert.match(migration, /credit_applied_tuition_id uuid unique/i);
  assert.doesNotMatch(migration, /update\s+public\.teacher_classes\s+set/i);
  assert.doesNotMatch(migration, /insert into\s+public\.class_students/i);
  assert.match(page, /Não bloqueia vaga nem horário em turmas/);
});

test("teacher-only RPCs require MFA and private data remain behind RLS", () => {
  assert.match(migration, /alter table private\.promotion_reservations enable row level security/i);
  assert.match(migration, /alter table private\.promotion_reservation_audit enable row level security/i);
  assert.match(migration, /revoke all on private\.promotion_reservations from public, anon, authenticated/i);
  assert.match(migration, /is_teacher_admin_mfa\(\)/);
  assert.match(migration, /revoke all on function public\.get_teacher_promotion_reservations\(\) from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function public\.get_teacher_promotion_reservations\(\) to authenticated/i);
});

test("automatic conversion requires uniquely identified active enrolled phone holder", () => {
  assert.match(migration, /select count\(\*\) from public\.profiles p where p\.enrolled=true and p\.archived=false/);
  assert.match(migration, /matched_student_id=new\.id/);
  assert.match(migration, /conversion_source is distinct from 'dismissed'/);
  assert.match(migration, /reconcile_promotion_profile_update/);
  assert.match(migration, /set_teacher_promotion_reservation_status/);
});

test("the system preserves accounting without automatic double charging", () => {
  assert.match(migration, /credit_applied_tuition_id is null/);
  assert.match(migration, /target_tuition\.amount_due<>r\.amount_paid/);
  assert.match(migration, /public\.record_tuition_payment/);
  assert.match(migration, /r\.credit_applied_tuition_id is not null/);
  assert.match(script, /item => !item\.credit_applied_tuition_id/);
  assert.match(page, /valor da reserva não é lançado automaticamente como mensalidade/i);
});

test("structured availability cannot contain arbitrary day and time values", () => {
  assert.match(validation, /private\.valid_promotion_availability/);
  assert.match(validation, /split_part\(slot\.value,'\|',1\)/);
  assert.match(validation, /split_part\(slot\.value,'\|',2\)/);
  assert.match(validation, /promotion_reservations_availability_valid/);
  assert.match(page, /id="reserveAvailability"/);
});

test("interface is an unindexed teacher-only page with a navigation entry", () => {
  assert.match(page, /name="robots" content="noindex, nofollow"/);
  assert.match(page, /id="reservationForm"/);
  assert.match(page, /id="reservationsMatching"/);
  assert.match(read("professor_home.js"), /href: "\/reservas-de-vagas\/"/);
  assert.match(read("trial_lesson_scheduler.js"), /CRIAR RESERVA PROMOCIONAL/);
  assert.match(script, /fillFromTrialLesson/);
  assert.match(read("professor\/professor_icons.js"), /'reservas-de-vagas': '<svg/);
  assert.doesNotMatch(page, /\bonline\b/i);
  assert.doesNotMatch(script, /\bonline\b/i);
});
