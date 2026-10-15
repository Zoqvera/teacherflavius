const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261013113816_notify_teacher_about_makeup_bookings.sql"),
  "utf8"
);
const notifier = fs.readFileSync(
  path.join(root, "supabase/functions/notify-makeup-booking/index.ts"),
  "utf8"
);

test("each booking confirmation queues a distinct and deduplicated teacher email", function () {
  assert.match(migration, /notification_type in \('booking_confirmation', 'cancellation', 'teacher_booking'\)/);
  assert.match(migration, /after insert on public\.makeup_class_email_notifications/i);
  assert.match(migration, /when \(new\.notification_type = 'booking_confirmation'\)/);
  assert.match(migration, /on conflict \(booking_id, notification_type\) do nothing/i);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /revoke all on function private\.enqueue_teacher_makeup_booking_email\(\)/i);
});

test("teacher notice is sent from the usual account to a separate configured recipient", function () {
  assert.match(notifier, /Teacher Flávio <contato@teacherflavius\.com>/);
  assert.match(notifier, /TEACHER_BOOKING_TYPE = "teacher_booking"/);
  assert.match(notifier, /MAKEUP_TEACHER_NOTIFICATION_EMAIL/);
  assert.match(notifier, /ENROLLMENT_NOTIFICATION_EMAIL/);
  assert.match(notifier, /\|\| "contato@teacherflavius\.com"/);
  assert.match(notifier, /isTeacherBooking \? teacherEmail : booking\.student_email/);
  assert.match(notifier, /isTeacherBooking\)[\s\S]*Nova reposição:/);
  assert.match(notifier, /Idempotency-Key/);
  assert.match(notifier, /makeup-\$\{notificationType\}-\$\{notification\.id\}/);
});

test("calendar action contains correct instants, timezone and meeting link", function () {
  assert.match(notifier, /calendar\.google\.com\/calendar\/r\/eventedit/);
  assert.match(notifier, /formatCalendarInstant\(startsAt\)/);
  assert.match(notifier, /formatCalendarInstant\(endsAt\)/);
  assert.match(notifier, /toISOString\(\)/);
  assert.match(notifier, /"stz", MAKEUP_TIME_ZONE/);
  assert.match(notifier, /"etz", MAKEUP_TIME_ZONE/);
  assert.match(notifier, /"location", meetingUrl/);
  assert.match(notifier, /Adicionar ao Google Agenda/);
  assert.match(notifier, /escapeHtml\(calendarUrl\)/);
});

test("existing student messages and cancellation branches remain available", function () {
  assert.match(notifier, /notificationType === "cancellation"/);
  assert.match(notifier, /notificationType !== "booking_confirmation"/);
  assert.match(notifier, /else if \(isCancellation\)/);
  assert.match(notifier, /Reposição de aula confirmada/);
  assert.match(notifier, /Reposição de aula cancelada/);
});
