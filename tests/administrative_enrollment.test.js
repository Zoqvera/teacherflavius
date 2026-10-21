const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { isValidDate, weekdayOf, validateEnrollment } =
  require("../matricula-administrativa/validation.js");

const classInfo = {
  class_number: 29,
  class_type: "quintet",
  class_weekday: 4,
  class_start_time: "10:00:00",
  first_lesson_date: "2026-10-01",
};

const validEnrollment = {
  name: "  Aluno Teste  ",
  contact_email: "pessoa@example.com",
  whatsapp: "(34) 99999-9999",
  first_lesson_date: "2026-10-22",
  monthly_fee: "50.00",
  classes_per_month: "4",
  due_day: "10",
  first_due_date: "2026-10-23",
};

test("teacher-selected first lesson must match the class weekday", () => {
  assert.equal(weekdayOf("2026-10-22"), 4);
  const values = validateEnrollment(validEnrollment, classInfo, "2026-10-21");
  assert.equal(values.first_lesson_date, "2026-10-22");
  assert.equal(values.class_number, 29);
  assert.equal(values.name, "Aluno Teste");
  assert.equal(values.whatsapp, "34999999999");
});

test("reject wrong class weekday and stale or malformed dates", () => {
  assert.throws(() => validateEnrollment({
    ...validEnrollment, first_lesson_date: "2026-10-23",
  }, classInfo, "2026-10-21"), /dia da semana/);
  assert.throws(() => validateEnrollment({
    ...validEnrollment, first_due_date: "2026-10-20",
  }, classInfo, "2026-10-21"), /hoje ou uma data futura/);
  assert.equal(isValidDate("2026-02-29"), false);
  assert.equal(isValidDate("2028-02-29"), true);
});

test("validates fee, contracted classes and class type", () => {
  assert.throws(() => validateEnrollment({
    ...validEnrollment, monthly_fee: "0",
  }, classInfo, "2026-10-21"), /valor mensal/);
  assert.throws(() => validateEnrollment({
    ...validEnrollment, classes_per_month: "0",
  }, classInfo, "2026-10-21"), /quantidade mensal/);
  assert.throws(() => validateEnrollment(validEnrollment, {
    ...classInfo, class_type: "experimental",
  }, "2026-10-21"), /turma regular/);
});

test("backend enrollment is atomic, service-role only and blocks portal access", () => {
  const sql = readFileSync(join(__dirname,
    "../supabase/migrations/20261021170211_administrative_student_enrollment.sql"), "utf8");
  assert.match(sql, /create_teacher_administrative_student_internal/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /grant execute on function public\.create_teacher_administrative_student_internal\([\s\S]*?to service_role/i);
  assert.match(sql, /revoke all on function public\.create_teacher_administrative_student_internal\([\s\S]*?from public, anon, authenticated/i);
  assert.match(sql, /access_mode = 'administrative'/);
  assert.match(sql, /insert into public\.class_students/);
  assert.match(sql, /insert into public\.student_billing_settings/);
  assert.match(sql, /private\.ensure_first_tuition_for_student/);
});

test("Edge Function authenticates teacher and bans internal account", () => {
  const edge = readFileSync(join(__dirname,
    "../supabase/functions/create-administrative-student/index.ts"), "utf8");
  assert.match(edge, /authenticated\.auth\.getUser\(token\)/);
  assert.match(edge, /authenticated\.rpc\("is_teacher_admin"\)/);
  assert.match(edge, /ban_duration: ACCESS_BAN_DURATION/);
  assert.match(edge, /admin\.auth\.admin\.deleteUser\(studentId\)/);
  assert.match(edge, /admin\.rpc\("create_teacher_administrative_student_internal"/);
});

test("admin registration stays out of search results and in teacher navigation", () => {
  const html = readFileSync(join(__dirname,
    "../matricula-administrativa", ["index", "html"].join(".")), "utf8");
  const professor = readFileSync(join(__dirname, ["..", "professor"].join("/") + "." + "html"), "utf8");
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /name="first_lesson_date"/);
  assert.match(html, /name="first_due_date"/);
  assert.match(professor, /href="\/matricula-administrativa\/"/);
});
