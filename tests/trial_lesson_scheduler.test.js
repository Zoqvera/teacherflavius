const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scheduler = require("../trial_lesson_scheduler.js");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260910121205_add_trial_lesson_appointments.sql"),
  "utf8"
);
const historyMigration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260910122016_preserve_trial_lesson_class_history.sql"),
  "utf8"
);
const enrollmentMigration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260922135728_add_trial_lesson_enrollment_conversion.sql"),
  "utf8"
);
const editingMigration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260922200208_add_trial_lesson_editing.sql"),
  "utf8"
);
const schedulerSource = fs.readFileSync(path.join(__dirname, "../trial_lesson_scheduler.js"), "utf8");
const professorHome = fs.readFileSync(path.join(__dirname, "../professor_home.js"), "utf8");

test("normalizes WhatsApp contacts without leaking formatting into wa.me", function () {
  assert.equal(scheduler.whatsappDigits("+55 (16) 99999-1234"), "5516999991234");
  assert.equal(scheduler.whatsappUrl("+55 (16) 99999-1234"), "https://wa.me/5516999991234");
  assert.equal(scheduler.whatsappUrl("123"), "");
});

test("suggests the next occurrence of a class", function () {
  const mondayBeforeClass = {
    year: 2026,
    month: 9,
    day: 7,
    isoDate: "2026-09-07",
    isoWeekday: 1,
    totalMinutes: 19 * 60
  };
  const mondayAfterClass = { ...mondayBeforeClass, totalMinutes: 21 * 60 };

  assert.equal(scheduler.nextClassDate(1, "20:00:00", mondayBeforeClass), "2026-09-07");
  assert.equal(scheduler.nextClassDate(1, "20:00:00", mondayAfterClass), "2026-09-14");
  assert.equal(scheduler.nextClassDate(3, "09:00:00", mondayBeforeClass), "2026-09-09");
});

test("validates that class appointments use the class weekday", function () {
  assert.equal(scheduler.isClassDateValid("2026-09-09", 3), true);
  assert.equal(scheduler.isClassDateValid("2026-09-10", 3), false);
});

test("labels statuses and separates upcoming appointments", function () {
  assert.equal(scheduler.statusLabel("scheduled"), "AGENDADA");
  assert.equal(scheduler.statusLabel("completed"), "CONCLUÍDA");
  assert.equal(
    scheduler.isUpcoming({ status: "scheduled", starts_at: "2030-01-01T12:00:00Z" }, Date.parse("2029-01-01T00:00:00Z")),
    true
  );
  assert.equal(
    scheduler.isUpcoming({ status: "cancelled", starts_at: "2030-01-01T12:00:00Z" }, Date.parse("2029-01-01T00:00:00Z")),
    false
  );
});


test("converts scheduled timestamps to editable Sao Paulo form values", function () {
  assert.deepEqual(
    scheduler.formDateTimeParts("2026-09-22T18:30:00Z"),
    { date: "2026-09-22", time: "15:30" }
  );
});

test("allows editing only while a trial lesson is scheduled", function () {
  assert.equal(scheduler.canEditAppointment({ status: "scheduled" }), true);
  assert.equal(scheduler.canEditAppointment({ status: "completed" }), false);
  assert.equal(scheduler.canEditAppointment({ status: "cancelled" }), false);
});

test("protects trial lesson editing with MFA and scheduled-only validation", function () {
  assert.match(editingMigration, /update_teacher_trial_lesson/i);
  assert.match(editingMigration, /is_teacher_admin_mfa\(\)/i);
  assert.match(editingMigration, /appointment_status <> 'scheduled'/i);
  assert.match(editingMigration, /tc\.class_type in \('quartet', 'eight_students'\)/i);
  assert.match(editingMigration, /revoke all on function public\.update_teacher_trial_lesson/i);
  assert.match(editingMigration, /grant execute on function public\.update_teacher_trial_lesson/i);
  assert.match(schedulerSource, /data-trial-edit="true"/);
  assert.match(schedulerSource, /update_teacher_trial_lesson/);
  assert.match(schedulerSource, /SALVAR ALTERAÇÕES/);
});

test("allows enrollment conversion only for completed trial lessons", function () {
  assert.equal(scheduler.canUpdateEnrollment({ status: "completed" }), true);
  assert.equal(scheduler.canUpdateEnrollment({ status: "scheduled" }), false);
  assert.equal(
    scheduler.isEnrolledAfterTrial({ status: "completed", enrolled_after_trial: true }),
    true
  );
  assert.equal(
    scheduler.isEnrolledAfterTrial({ status: "completed", enrolled_after_trial: false }),
    false
  );
});

test("persists and protects the trial enrollment conversion flag", function () {
  assert.match(enrollmentMigration, /enrolled_after_trial_at timestamptz/i);
  assert.match(enrollmentMigration, /status = 'completed'/i);
  assert.match(enrollmentMigration, /set_teacher_trial_lesson_enrollment/i);
  assert.match(enrollmentMigration, /is_teacher_admin_mfa\(\)/i);
  assert.match(enrollmentMigration, /grant execute on function public\.set_teacher_trial_lesson_enrollment\(uuid,boolean\) to authenticated/i);
  assert.match(schedulerSource, /MATRICULOU/);
  assert.match(schedulerSource, /Matricularam/);
});

test("keeps visitor data private and protects administrative RPCs with MFA", function () {
  assert.match(migration, /create table private\.trial_lesson_appointments/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table private\.trial_lesson_appointments from public, anon, authenticated/i);
  assert.match(migration, /is_teacher_admin_mfa\(\)/i);
  assert.match(migration, /trial_lesson_appointments_unique_active_person_time_idx/i);
  assert.match(migration, /grant execute on function public\.create_teacher_trial_lesson/i);
});

test("preserves the class name snapshot when a historical class reference is removed", function () {
  assert.match(historyMigration, /lesson_mode = 'class' and class_name_snapshot is not null/i);
  assert.match(historyMigration, /lesson_mode = 'individual' and class_number is null and class_name_snapshot is null/i);
});

test("adds a clean public route card to the professor dashboard", function () {
  assert.match(professorHome, /id: "aulas-experimentais"/i);
  assert.match(professorHome, /href: "\/aulas-experimentais\/"/i);
  assert.match(professorHome, /label: "AULAS EXPERIMENTAIS"/i);
});
