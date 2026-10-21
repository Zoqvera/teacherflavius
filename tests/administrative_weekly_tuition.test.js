const assert = require("node:assert/strict");
const { test } = require("node:test");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const root = join(__dirname, "..");
const read = (...paths) => readFileSync(join(root, ...paths), "utf8");
const foundation = read("supabase", "migrations",
  "20261021193844_administrative_weekly_tuition.sql");
const lifecycle = read("supabase", "migrations",
  "20261021194450_weekly_tuition_permissions_lifecycle.sql");

test("three-class exception is restricted to administrative individual weekly plans", () => {
  assert.match(foundation, /maximum_classes integer := 2/);
  assert.match(foundation, /p\.access_mode = 'administrative' and p\.class_type = 'INDIVIDUAL'/);
  assert.match(foundation, /maximum_classes := 3/);
});

test("weekly tuition is independent from monthly billing and unique per Tuesday", () => {
  assert.match(foundation, /create table if not exists public\.administrative_weekly_tuition/);
  assert.match(foundation, /unique \(student_id, due_date\)/);
  assert.match(foundation, /extract\(isodow from due_date\) = 2/);
  assert.match(foundation, /on conflict \(student_id,due_date\) do nothing/);
  assert.match(foundation, /insert into public\.administrative_weekly_tuition\(student_id,due_date,amount_due\)/);
  assert.doesNotMatch(foundation, /insert into public\.monthly_tuition\s*\(/);
});

test("financial lifecycle protects archived and paused students", () => {
  assert.match(foundation, /p\.enrolled is true and p\.archived is false/);
  assert.match(foundation, /s\.course_status='paused'/);
  assert.match(lifecycle, /set active=false,updated_at=now\(\)/);
  assert.match(lifecycle, /set active=true,/);
  assert.match(lifecycle, /payment_date is null/);
  assert.match(foundation, /teacher-administrative-weekly-tuition/);
});

test("registration requires three first lesson dates and service-only RPC", () => {
  assert.match(foundation, /jsonb_array_length\(target_classes\) <> 3/);
  assert.match(foundation, /item->>'first_lesson_date'/);
  assert.match(foundation, /extract\(isodow from actual_date\)/);
  assert.match(foundation, /target_class\.class_start_time<>'14:00'/);
  assert.match(foundation, /grant execute on function public\.create_teacher_administrative_weekly_student_internal\([\s\S]*?to service_role/);
  assert.match(foundation, /revoke all on function public\.create_teacher_administrative_weekly_student_internal\([\s\S]*?from public,anon,authenticated/);
});

test("browser supports weekly enrollment and teacher payment registration", () => {
  const edge = read("supabase", "functions", "create-administrative-student", "index.ts");
  const registration = read("matricula-semanal", "app.js");
  const billing = read("cobrancas-semanais", "app.js");
  const menu = read("professor.html");
  assert.match(edge, /authenticated\.rpc\("is_teacher_admin"\)/);
  assert.match(edge, /create_teacher_administrative_weekly_student_internal/);
  assert.match(edge, /ban_duration: ACCESS_BAN_DURATION/);
  assert.match(registration, /first_lesson_date: date/);
  assert.match(registration, /billing_frequency: "weekly"/);
  assert.match(billing, /record_teacher_administrative_weekly_payment/);
  assert.match(menu, /href="\/matricula-semanal\/"/);
  assert.match(menu, /href="\/cobrancas-semanais\/"/);
});

test("weekly administration pages are excluded from search index", () => {
  for (const path of ["matricula-semanal", "cobrancas-semanais"]) {
    const html = read(path, ["index", "html"].join("."));
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    assert.match(html, /name="first_due_date"|id="statusFilter"/);
  }
});
