const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const calendar = require("../area-do-estudante/minhas-aulas/calendar.js");
const application = fs.readFileSync(path.join(root, "area-do-estudante/minhas-aulas/app.js"), "utf8");
const markup = fs.readFileSync(path.join(root, "area-do-estudante/minhas-aulas/index.html"), "utf8");
const notifier = fs.readFileSync(path.join(root, "supabase/functions/notify-makeup-booking/index.ts"), "utf8");

const booking = Object.freeze({
  studentId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  classNumber: 17,
  className: "Conversação, nível B1; especial",
  startsAt: "2026-10-20T21:00:00.000Z",
  endsAt: "2026-10-20T22:00:00.000Z",
  meetingUrl: "https://meet.google.com/abc-defg-hij",
});

function unfoldIcs(text) {
  return text.replace(/\r\n[ \t]/g, "").split("\r\n");
}

test("calendar link uses UTC instants, Sao Paulo timezone and verified Meet URL", () => {
  const url = new URL(calendar.googleCalendarUrl(booking));
  assert.equal(url.hostname, "calendar.google.com");
  assert.equal(url.searchParams.get("action"), "TEMPLATE");
  assert.equal(url.searchParams.get("dates"), "20261020T210000Z/20261020T220000Z");
  assert.equal(url.searchParams.get("stz"), "America/Sao_Paulo");
  assert.equal(url.searchParams.get("etz"), "America/Sao_Paulo");
  assert.equal(url.searchParams.get("location"), booking.meetingUrl);
  assert.equal(url.searchParams.get("text"), "Reposição de inglês — " + booking.className);
});

test("ICS is UTF-8 compatible RFC 5545 data with CRLF, escaped text and stable UID", () => {
  const text = calendar.icsContent(booking, "2026-10-15T03:00:00Z");
  const lines = unfoldIcs(text);
  assert.equal(lines[0], "BEGIN:VCALENDAR");
  assert.equal(lines.at(-2), "END:VCALENDAR");
  assert.ok(lines.includes("METHOD:PUBLISH"));
  assert.ok(lines.includes("BEGIN:VEVENT"));
  assert.ok(lines.includes("DTSTART:20261020T210000Z"));
  assert.ok(lines.includes("DTEND:20261020T220000Z"));
  assert.ok(lines.includes("DTSTAMP:20261015T030000Z"));
  assert.ok(lines.includes("UID:reposicao-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee-17-20261020T210000Z@teacherflavius.com"));
  assert.ok(lines.includes("SUMMARY:Reposição de inglês — Conversação\\, nível B1\\; especial"));
  assert.ok(lines.includes("LOCATION:https://meet.google.com/abc-defg-hij"));
  assert.ok(lines.some((line) => line.startsWith("DESCRIPTION:Turma: ")));
  assert.equal(calendar.getUid(booking), calendar.getUid({ ...booking }));
  assert.match(text, /\r\n/);
  assert.doesNotMatch(text.replace(/\r\n/g, ""), /\n/);
  for (const line of text.split("\r\n").filter(Boolean)) {
    assert.ok(new TextEncoder().encode(line).length <= 75, "ICS physical line must not exceed 75 bytes");
  }
});

test("calendar helper rejects incomplete, unsafe or contradictory event details", () => {
  assert.throws(() => calendar.icsContent({ ...booking, endsAt: booking.startsAt }));
  assert.throws(() => calendar.googleCalendarUrl({ ...booking, startsAt: "not-a-date" }));
  assert.throws(() => calendar.googleCalendarUrl({ ...booking, studentId: "broken" }));
  assert.throws(() => calendar.googleCalendarUrl({ ...booking, classNumber: "NaN" }));
  const malicious = calendar.googleCalendarUrl({ ...booking, meetingUrl: "javascript:alert(1)" });
  assert.equal(new URL(malicious).searchParams.get("location"), null);
});

test("private student page only presents calendar actions for booked replacement lessons", () => {
  assert.match(markup, /minhas-aulas\/calendar\.js\?v=/);
  assert.ok(markup.indexOf("calendar.js") < markup.indexOf("app.js"));
  assert.match(application, /credit\.status === "used" && window\.TeacherFlaviusLessonCalendar/);
  assert.match(application, /googleCalendarUrl\(event\)/);
  assert.match(application, /BAIXAR ARQUIVO \.ICS/);
  assert.match(application, /downloadCalendarFile\(button\)/);
  assert.match(application, /item\.status === "used" && String\(item\.credit_id\)/);
  assert.match(application, /new Blob\(\[content\], \{ type: "text\/calendar;charset=utf-8" \}\)/);
  assert.match(application, /authenticatedStudentId = session\.user\.id/);
  assert.doesNotMatch(application, /window\.location\.href\s*=\s*calendarUrl/);
});

test("email confirmations attach ICS for both recipients but not cancellations", () => {
  assert.match(notifier, /\.select\("id, slot_id, student_id, class_number,/);
  assert.match(notifier, /function makeIcsAttachment\(/);
  assert.match(notifier, /content_type: "text\/calendar; charset=utf-8"/);
  assert.match(notifier, /filename: "reposicao-aula\.ics"/);
  assert.match(notifier, /attachments: \[makeIcsAttachment\(/);
  assert.match(notifier, /\.\.\.\(!isCancellation \? \{/);
  assert.match(notifier, /isTeacherNotice \? "teacher" : "student"/);
  assert.match(notifier, /new Date\(\)\.toISOString\(\)/);
  assert.match(notifier, /METHOD:PUBLISH/);
  assert.match(notifier, /UID:\$\{uid\}/);
  assert.match(notifier, /reposicao-\$\{studentId\}-\$\{classNumber\}-\$\{formatCalendarInstant\(startsAt\)\}@teacherflavius\.com/);
  assert.match(notifier, /"Idempotency-Key": `makeup-\$\{notificationType\}-\$\{notification\.id\}`/);
});
