const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "alunos-do-dia/index.html"), "utf8");
const area = fs.readFileSync(path.join(root, "area_do_estudante.html"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260923150718_add_students_of_day.sql"),
  "utf8"
);
const studentsOfDay = require("../alunos-do-dia/alunos_do_dia.js");

test("builds the requested WhatsApp confirmation message", function () {
  assert.equal(
    studentsOfDay.DEFAULT_MESSAGE,
    "Olá, hoje você tem aula. Você vai poder participar?"
  );
  assert.equal(studentsOfDay.whatsappNumber("(34) 99999-9999"), "5534999999999");
  assert.equal(
    studentsOfDay.whatsappUrl("(34) 99999-9999"),
    "https://wa.me/5534999999999?text=" +
      encodeURIComponent("Olá, hoje você tem aula. Você vai poder participar?")
  );
});

test("supports regular, makeup and trial lesson labels", function () {
  assert.equal(studentsOfDay.lessonKindLabel("regular"), "AULA REGULAR");
  assert.equal(studentsOfDay.lessonKindLabel("makeup"), "REPOSIÇÃO");
  assert.equal(studentsOfDay.lessonKindLabel("trial"), "AULA EXPERIMENTAL");
});

test("keeps the students-of-day page private from search engines", function () {
  assert.match(page, /meta name="robots" content="noindex, nofollow"/i);
  assert.match(page, /link rel="canonical" href="\/alunos-do-dia\/"/i);
  assert.equal(sitemap.includes("/alunos-do-dia/"), false);
});

test("adds the card only inside the professor section of the student area", function () {
  const sectionStart = area.indexOf('id="professorAreaSection"');
  const sectionEnd = area.indexOf("</section>", sectionStart);
  const professorSection = area.slice(sectionStart, sectionEnd);
  assert.ok(sectionStart >= 0);
  assert.match(professorSection, /href="\/alunos-do-dia\/"/);
  assert.match(professorSection, /data-teacher-students-today-card="true"/);
});

test("protects all students-of-day RPCs with teacher MFA", function () {
  assert.match(migration, /function public\.get_teacher_students_of_day\(\)/i);
  assert.match(migration, /function public\.set_teacher_day_student_whatsapp\(/i);
  assert.match(migration, /function public\.cancel_teacher_day_lesson\(/i);
  assert.equal((migration.match(/is_teacher_admin_mfa\(\)/g) || []).length, 3);
  assert.match(migration, /revoke all on function public\.get_teacher_students_of_day\(\) from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.get_teacher_students_of_day\(\) to authenticated/i);
});

test("collects regular lessons, makeup bookings and trial lessons", function () {
  assert.match(migration, /from public\.teacher_classes tc/i);
  assert.match(migration, /from public\.makeup_class_bookings booking/i);
  assert.match(migration, /from private\.trial_lesson_appointments appointment/i);
  assert.match(migration, /appointment\.status = 'scheduled'/i);
  assert.match(migration, /booking\.status = 'confirmed'/i);
});

test("cancelling a regular lesson is occurrence-specific and does not change enrollment capacity", function () {
  assert.match(migration, /private\.student_regular_lesson_cancellations/i);
  assert.match(migration, /unique \(student_id, class_number, lesson_date\)/i);
  assert.doesNotMatch(migration, /get_class_operational_capacity/i);
  assert.doesNotMatch(migration, /update public\.teacher_classes/i);
});

test("manual WhatsApp registration updates the appropriate student record", function () {
  assert.match(migration, /update public\.profiles[\s\S]*set whatsapp = normalized_digits/i);
  assert.match(migration, /update private\.trial_lesson_appointments appointment[\s\S]*set whatsapp = trial_whatsapp/i);
});
