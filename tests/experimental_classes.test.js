const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(root, filename), "utf8");
const migration = read("supabase/migrations/20261009193000_experimental_classes_auto_conversion.sql");
const guards = read("supabase/migrations/20261009195000_experimental_class_transition_guards.sql");
const teacherClasses = read("turmas.js");
const teacherClassesPage = read("turmas.html");
const bookingUi = read("trial_lesson_scheduler.js");
const board = read("quadro-de-turmas.html");
const scheduler = require("../trial_lesson_scheduler.js");

test("EXPERIMENTAL is a class type, not a regular student plan", () => {
  assert.match(migration, /teacher_classes_class_type_check/);
  assert.match(migration, /'quintet','individual','experimental'/);
  assert.doesNotMatch(migration, /alter table public\.profiles.*experimental/is);
  assert.match(migration, /block_regular_enrollment_in_experimental/);
  assert.match(guards, /guard_experimental_class_transition/);
  assert.match(guards, /reject_experimental_makeup_slots/);
});

test("experimental enrollment recognition matches unique active phone holders only after class time", () => {
  assert.match(migration, /private\.normalize_trial_phone/);
  assert.match(migration, /group by private\.normalize_trial_phone\(p\.whatsapp\) having count\(\*\)=1/);
  assert.match(migration, /trial\.starts_at<now\(\) and trial\.status<>'cancelled'/);
  assert.match(migration, /p\.enrolled=true and p\.archived=false/);
  assert.match(migration, /conversion_source is distinct from 'manual'/);
  assert.match(migration, /conversion_source is distinct from 'dismissed'/);
  assert.match(migration, /reconcile_trial_conversion_update/);
  assert.match(migration, /reconcile_teacher_trial_enrollments/);
});

test("trial bookings reject active enrolled phone holders and enforce places by class occurrence", () => {
  assert.match(migration, /private\.check_experimental_booking/);
  assert.match(migration, /pg_advisory_xact_lock\(73008,new\.class_number\)/);
  assert.match(migration, /t\.starts_at=new\.starts_at/);
  assert.match(migration, /celular.*aluno matriculado/i);
  assert.match(migration, /class_number=92 then 10 else 8/);
});

test("teacher interfaces handle trial classes without regular student enrollment", () => {
  assert.match(teacherClassesPage, /<option value="experimental">EXPERIMENTAL<\/option>/);
  assert.match(teacherClasses, /label:"EXPERIMENTAL"/);
  assert.match(teacherClasses, /\? "\/aulas-experimentais\/"/);
  assert.match(board, /agendado\(s\) na próxima sessão/);
  assert.match(bookingUi, /get_teacher_trial_conversion_sources/);
  assert.match(bookingUi, /reconcile_teacher_trial_enrollments/);
  assert.match(bookingUi, /AUTOMÁTICO/);
});

test("manual conversion override remains available after automatic detection", () => {
  assert.match(migration, /conversion_source=case when target_enrolled then 'manual' else 'dismissed' end/);
  assert.equal(scheduler.isEnrolledAfterTrial({
    status: "completed",
    enrolled_after_trial: true
  }), true);
  assert.equal(scheduler.isEnrolledAfterTrial({
    status: "scheduled",
    enrolled_after_trial: true,
    starts_at: "2026-01-01T12:00:00Z"
  }), true);
  assert.equal(scheduler.isEnrolledAfterTrial({
    status: "cancelled",
    enrolled_after_trial: true,
    starts_at: "2026-01-01T12:00:00Z"
  }), false);
});
