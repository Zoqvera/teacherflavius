const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");
const SQL = read("supabase/migrations/20261022220000_academic_v2_shared_closure_lock.sql");
const CLOSURE_SQL = read(
  "supabase/migrations/20261022212500_academic_v2_auto_attendance_and_closure.sql"
);
const V2_APP = read("roteiro-da-aula-v2/app.js");
const V2_INDEX = read("roteiro-da-aula-v2/index.html");
const ACTIVE_INDEX = read("roteiro-da-aula/index.html");
const MODEL_SOURCE = read("roteiro-da-aula-v2/model.js");
const RATING_SOURCE = read("roteiro-da-aula-v2/question_ratings.js");

test("all three teacher recording paths share the closing worker's transactional lock", () => {
  assert.match(SQL, /pg_catalog\.pg_advisory_xact_lock\(20261022, 4\)/);
  assert.match(CLOSURE_SQL, /pg_catalog\.pg_try_advisory_xact_lock\(20261022, 4\)/);
  for (const endpoint of [
    "mark_teacher_lesson_presented_v2",
    "rate_teacher_conversation_question_v2",
    "mark_teacher_v2_participation"
  ]) {
    const start = SQL.indexOf("create or replace function public." + endpoint);
    assert.ok(start !== -1, endpoint + " definition missing");
    const remainder = SQL.slice(start);
    const end = remainder.indexOf("end;\n$function$;");
    assert.ok(end !== -1, endpoint + " SQL function ending missing");
    const definition = remainder.slice(0, end);
    assert.match(definition, /private\.assert_teacher_v2_session_open\(/);
  }
});

test("presentation and evaluation writes must occur inside the permitted class window", () => {
  assert.match(SQL, /now\(\) >= lesson\.starts_at \+ interval '90 minutes'/);
  assert.match(SQL, /now\(\) < lesson\.starts_at - interval '30 minutes'/);
  assert.match(SQL, /from private\.academic_class_session_finalizations closed/);
  assert.match(SQL, /private\.resolve_academic_lesson\(/);
  assert.match(SQL, /public\.is_teacher_admin\(\)/);
  assert.match(SQL, /revoke all on function private\.assert_teacher_v2_session_open/i);
  assert.doesNotMatch(SQL, /(?:delete|truncate|drop table)\s+(?:from\s+)?private\.academic_lesson_occurrences/i);
});

test("v2 presentation writes never call the legacy RPC directly", () => {
  assert.match(V2_APP, /client\.rpc\("mark_teacher_lesson_presented_v2"/);
  assert.doesNotMatch(V2_APP, /client\.rpc\("mark_teacher_lesson_presented"/);
  assert.match(SQL, /return public\.mark_teacher_lesson_presented\(/);
  assert.match(V2_APP, /PRESENTATION_REGISTRATION_ENABLED = true/);
});

test("teacher-only preview stays restricted and ordinary operational route is unchanged", () => {
  assert.match(V2_INDEX, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(ACTIVE_INDEX, /src="\/roteiro-da-aula\/app\.js/);
  assert.doesNotMatch(ACTIVE_INDEX, /roteiro-da-aula-v2/);
  assert.match(V2_APP, /rpc\("is_teacher_admin"\)/);
  assert.match(V2_APP, /QUESTION_RATINGS_ENABLED = true/);
  assert.match(V2_APP, /SESSION_LIFECYCLE_ENABLED = true/);
  assert.match(CLOSURE_SQL, /enabled boolean not null default false/);
  assert.match(CLOSURE_SQL, /candidate\.starts_at >= control\.enabled_from/);
  assert.doesNotMatch(V2_INDEX + V2_APP, /\bonline\b/i);
});

test("student cancellation and class keys are stable across both views", () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(MODEL_SOURCE, context);
  const model = context.window.TeacherWorkspaceModel;
  const startsAt = "2026-10-22T18:00:00Z";
  const scheduled = {
    class_number: 55, class_name: "Turma 55", starts_at: startsAt,
    student_name: "Ana", attendance_status: "scheduled", lesson_status: "planned"
  };
  const cancelled = Object.assign({}, scheduled, {
    student_name: "Bia", attendance_status: "cancelled"
  });
  const groups = model.groupByClass([scheduled, cancelled]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].students.length, 2);
  assert.equal(model.classSummary(groups[0]).total, 1);
  assert.equal(model.classSummary(groups[0]).cancelled, 1);
});

test("current attendance only follows successful evaluation acknowledgements", async () => {
  const context = vm.createContext({ window: {} });
  vm.runInContext(RATING_SOURCE, context);
  const ratings = context.window.TeacherQuestionRatings;
  const id = "33333333-3333-4333-8333-333333333333";
  const student = {
    lesson_kind: "regular",
    entry_id: "11111111-1111-4111-8111-111111111111",
    student_id: "22222222-2222-4222-8222-222222222222",
    starts_at: "2026-10-22T13:00:00Z",
    attendance_status: "scheduled",
    today_questions: [{ id }],
    review_questions: []
  };
  const service = ratings.create({
    async rpc() { return { data: null, error: { code: "P0001", message: "closed" } }; }
  });
  await assert.rejects(service.rate(student, "2026-10-22", id, "good", []),
    (error) => error.code === "P0001" && error.message === "closed");
  assert.equal(student.attendance_status, "scheduled");
});
