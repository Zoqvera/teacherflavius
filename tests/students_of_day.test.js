const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(root, "alunos-do-dia/index.html"), "utf8");
const area = fs.readFileSync(path.join(root, "area_do_estudante.html"), "utf8");
const professorHome = fs.readFileSync(path.join(root, "professor_home.js"), "utf8");
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260923150718_add_students_of_day.sql"),
  "utf8"
);
const cancellationAttendanceMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260923174203_record_no_show_on_day_cancel.sql"),
  "utf8"
);
const lessonDisplayMigration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260923175712_add_lesson_to_students_of_day.sql"),
  "utf8"
);
const studentsScript = fs.readFileSync(
  path.join(root, "alunos-do-dia/alunos_do_dia.js"),
  "utf8"
);
const studentsOfDay = require("../alunos-do-dia/alunos_do_dia.js");

test("builds the requested WhatsApp confirmation message", function () {
  assert.equal(
    studentsOfDay.DEFAULT_MESSAGE,
    "Olá, você tem aula hoje. Você confirma sua participação?"
  );
  assert.equal(studentsOfDay.whatsappNumber("(34) 99999-9999"), "5534999999999");
  assert.equal(
    studentsOfDay.whatsappUrl("(34) 99999-9999"),
    "https://wa.me/5534999999999?text=" +
      encodeURIComponent("Olá, você tem aula hoje. Você confirma sua participação?")
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

test("keeps the students-of-day card in the professor dashboard only", function () {
  assert.doesNotMatch(area, /href="\/alunos-do-dia\/"/);
  assert.match(professorHome, /id:\s*"alunos-do-dia"/);
  assert.match(professorHome, /href:\s*"\/alunos-do-dia\/"/);
  assert.match(professorHome, /label:\s*"ALUNOS DO DIA"/);
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

test("records a no-show when a regular or makeup lesson is cancelled from students of day", function () {
  assert.match(cancellationAttendanceMigration, /attendance_status[\s\S]*'Faltou'/i);
  assert.match(cancellationAttendanceMigration, /Não compareceu na aula\./);
  assert.match(cancellationAttendanceMigration, /insert into public\.student_frequency/i);
  assert.match(
    cancellationAttendanceMigration,
    /returning booking\.student_id, booking\.class_number[\s\S]*into resolved_student_id, resolved_class_number/i
  );
});

test("marks cancelled trial lessons as no-show", function () {
  assert.match(
    cancellationAttendanceMigration,
    /update private\.trial_lesson_appointments appointment[\s\S]*set status = 'no_show'/i
  );
  assert.doesNotMatch(
    cancellationAttendanceMigration,
    /update private\.trial_lesson_appointments appointment[\s\S]*set status = 'cancelled'/i
  );
});

test("keeps regular cancellation attendance idempotent", function () {
  assert.match(
    cancellationAttendanceMigration,
    /on conflict \(student_id, class_number, lesson_date\) do nothing/i
  );
  assert.match(cancellationAttendanceMigration, /get diagnostics cancellation_inserted = row_count/i);
  assert.match(cancellationAttendanceMigration, /if cancellation_inserted > 0 then/i);
});

test("confirms that cancellation also records absence in the interface", function () {
  assert.match(studentsScript, /Aula cancelada e ausência registrada\./);
});

test("calculates the lesson to present from numeric lesson history before today", function () {
  assert.match(lessonDisplayMigration, /lesson_to_present text/i);
  assert.match(lessonDisplayMigration, /clr\.class_date < target_date/i);
  assert.match(lessonDisplayMigration, /clr\.lesson_code ~ '\^L\[0-9\]\+\$'/i);
  assert.match(lessonDisplayMigration, /when progress\.max_lesson_number is null then 'L1'/i);
  assert.match(lessonDisplayMigration, /when progress\.max_lesson_number >= 74 then 'Concluído'/i);
  assert.match(lessonDisplayMigration, /'L' \|\| \(progress\.max_lesson_number \+ 1\)::text/i);
});

test("returns lessons for regular and makeup entries but not trial lessons", function () {
  assert.match(
    lessonDisplayMigration,
    /'regular'::text[\s\S]*as lesson_to_present/i
  );
  assert.match(
    lessonDisplayMigration,
    /'makeup'::text[\s\S]*as lesson_to_present/i
  );
  assert.match(
    lessonDisplayMigration,
    /'trial'::text[\s\S]*null::text as lesson_to_present/i
  );
});

test("renders the lesson to present only for regular and makeup cards", function () {
  const regular = studentsOfDay.lessonToPresentHtml({
    lesson_kind: "regular",
    lesson_to_present: "L12"
  });
  const makeup = studentsOfDay.lessonToPresentHtml({
    lesson_kind: "makeup",
    lesson_to_present: "L8"
  });
  const trial = studentsOfDay.lessonToPresentHtml({
    lesson_kind: "trial",
    lesson_to_present: null
  });

  assert.match(regular, /LIÇÃO A APRESENTAR/);
  assert.match(regular, /L12/);
  assert.match(makeup, /L8/);
  assert.equal(trial, "");
});
