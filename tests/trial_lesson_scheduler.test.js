const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const scheduler = require("../trial_lesson_scheduler.js");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260910121205_add_trial_lesson_appointments.sql"),
  "utf8"
);

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

test("keeps visitor data private and protects administrative RPCs with MFA", function () {
  assert.match(migration, /create table private\.trial_lesson_appointments/i);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all on table private\.trial_lesson_appointments from public, anon, authenticated/i);
  assert.match(migration, /is_teacher_admin_mfa\(\)/i);
  assert.match(migration, /trial_lesson_appointments_unique_active_person_time_idx/i);
  assert.match(migration, /grant execute on function public\.create_teacher_trial_lesson/i);
});
