const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "..", "supabase/functions/notify-makeup-booking/index.ts"),
  "utf8",
);

test("teacher calendar policy uses the student's server-side class type", () => {
  assert.match(source, /if \(isTeacherNotice\) \{[\s\S]*?\.from\("profiles"\)[\s\S]*?\.select\("class_type"\)[\s\S]*?\.eq\("id", booking\.student_id\)/);
  assert.match(source, /if \(profileError \|\| !studentProfile\) \{[\s\S]*?await failNotification/);
  assert.match(source, /String\(studentProfile\.class_type \?\? ""\)\.trim\(\)\.toUpperCase\(\) === "INDIVIDUAL"/);
  assert.doesNotMatch(source, /booking\.class_name\s*===\s*"INDIVIDUAL"/);
});

test("teacher booking only exposes Google Agenda if student is individual", () => {
  const begin = source.indexOf("  } else if (isTeacherBooking) {");
  const end = source.indexOf("  } else if (isCancellation) {", begin);
  assert.ok(begin >= 0 && end > begin);
  const section = source.slice(begin, end);
  assert.match(section, /const calendarUrl = isIndividualStudent\s*\? makeGoogleCalendarUrl\(/);
  assert.match(section, /\)\s*:\s*null;/);
  assert.match(section, /\.\.\.\(calendarUrl\s*\? \[/);
  assert.match(section, /\$\{calendarUrl\s*\? /);
  assert.match(section, /Adicionar ao Google Agenda/);
  assert.match(section, /O evento só será criado na sua agenda após você confirmar/);
});

test("all teacher emails are free from automatic ICS attachments", () => {
  assert.match(source, /notificationType === "booking_confirmation" \? \{\s*attachments:/);
  assert.doesNotMatch(source, /!isCancellation\s*\?\s*\{\s*attachments:/);
  assert.doesNotMatch(source, /calendar\.googleapis\.com|events\.insert|events\.patch|events\.delete/);
  assert.match(source, /\bString\(studentProfile\.class_type \?\? ""\)\.trim\(\)\.toUpperCase\(\) === "INDIVIDUAL"/);
});

test("teacher cancellation calendar removal instruction is individual-only", () => {
  const begin = source.indexOf("  if (isTeacherCancellation) {");
  const end = source.indexOf("  } else if (isTeacherBooking) {", begin);
  assert.ok(begin >= 0 && end > begin);
  const section = source.slice(begin, end);
  assert.match(section, /\.\.\.\(isIndividualStudent\s*\? \[/);
  assert.match(section, /\$\{isIndividualStudent\s*\?/);
  assert.doesNotMatch(section, /makeGoogleCalendarUrl\(/);
});

test("student links and ICS plus teacher administrative emails remain intact", () => {
  assert.match(source, /const studentCalendarUrl = makeGoogleCalendarUrl\(/);
  assert.match(source, /"student",\s*\);/);
  assert.match(source, /notificationType === "booking_confirmation"/);
  assert.match(source, /makeIcsAttachment\(/);
  assert.match(source, /isTeacherNotice \? teacherEmail : booking\.student_email/);
  assert.match(source, /TEACHER_CANCELLATION_TYPE = "teacher_cancellation"/);
  assert.match(source, /TEACHER_BOOKING_TYPE = "teacher_booking"/);
  assert.match(source, /Idempotency-Key/);
});
