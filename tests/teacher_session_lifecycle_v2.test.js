const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const SOURCE = read("roteiro-da-aula-v2/session_lifecycle.js");
const PAGE = read("roteiro-da-aula-v2/index.html");
const APP = read("roteiro-da-aula-v2/app.js");
const OLD_PAGE = read("roteiro-da-aula-legado/index.html");
const SQL = read("supabase/migrations/20261022212500_academic_v2_auto_attendance_and_closure.sql");
const RLS_SQL = read("supabase/migrations/20261022214500_academic_v2_private_table_rls.sql");

const context = vm.createContext({ window: {} });
vm.runInContext(SOURCE, context);
const session = context.window.TeacherSessionLifecycle;
const STUDENT = "22222222-2222-4222-8222-222222222222";
const ENTRY = "11111111-1111-4111-8111-111111111111";
const START = "2026-10-22T13:00:00Z";
const DATE = "2026-10-22";

function student(overrides = {}) {
  return Object.assign({
    lesson_kind: "regular", entry_id: ENTRY,
    student_id: STUDENT, student_name: "Aluno",
    starts_at: START, attendance_status: "scheduled"
  }, overrides);
}

test("auto-closure occurs at 90 minutes, not before", () => {
  const begins = Date.parse(START);
  assert.equal(session.elapsedSinceClassStart(START, begins + 89 * 60000), false);
  assert.equal(session.elapsedSinceClassStart(START, begins + 90 * 60000), true);
  assert.equal(session.elapsedSinceClassStart("invalid", begins + 90 * 60000), false);
});

test("participation is exceptional and not available for cancellations or recorded absences", () => {
  const now = Date.parse(START);
  assert.equal(session.eligibleToMarkParticipation(student(), DATE, now), true);
  assert.equal(session.eligibleToMarkParticipation(student(), DATE, now - 31 * 60000), false);
  for (const attendance_status of ["present", "absent", "cancelled", "cancelled_finalized"]) {
    assert.equal(session.eligibleToMarkParticipation(student({ attendance_status }), DATE, now), false);
  }
  assert.equal(session.canAdjust(student(), "2026-10-23"), false);
  assert.equal(session.canAdjust(student({ entry_id: "invalid" }), DATE), false);
});

test("audited attendance correction requires reason and does not alter cancelled lessons", async () => {
  const calls = [];
  const lifecycle = session.create({
    async rpc(name, args) {
      calls.push({ name, args });
      return { data: { ok: true, attendance_status: args.target_status }, error: null };
    }
  });
  assert.throws(() => lifecycle.correctAttendance(student(), DATE, "absent", "curto"),
    /justificativa/i);
  assert.throws(() => lifecycle.correctAttendance(
    student({ attendance_status: "cancelled" }), DATE, "present",
    "Registro administrativo de presenca"
  ), /justificativa/i);
  await lifecycle.correctAttendance(
    student(), DATE, "present", "Registro administrativo de presenca"
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "correct_teacher_v2_attendance");
  assert.equal(calls[0].args.target_reason, "Registro administrativo de presenca");
});

test("participation and corrections use server RPC and never claim success on errors", async () => {
  const now = Date.parse(START);
  const lifecycle = session.create({
    async rpc(name) {
      assert.equal(name, "mark_teacher_v2_participation");
      return { data: { ok: false }, error: null };
    }
  });
  // The current test run is later than the fixed sample class start.
  assert.equal(session.eligibleToMarkParticipation(student(), DATE, now), true);
  await assert.rejects(lifecycle.markParticipation(student(), DATE), /servidor não confirmou/i);
});

test("closed sessions are grouped and can be read without changing active lesson records", async () => {
  const lifecycle = session.create({
    async rpc(name, params) {
      assert.equal(name, "get_teacher_v2_closed_sessions");
      assert.equal(params.target_date, DATE);
      return { data: [
        { class_number: 29, class_name: "Turma 29", starts_at: START,
          finalized_at: "2026-10-22T14:30:00Z",
          students: [{ student_id: STUDENT, attendance_status: "absent" }] }
      ], error: null };
    }
  });
  const result = await lifecycle.getClosedSessions(DATE);
  assert.equal(result.available, true);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].finalized, true);
  assert.equal(result.sessions[0].students[0].attendance_status, "absent");
});

test("nondeployed read-only history RPC does not break the preview", async () => {
  const lifecycle = session.create({
    rpc: async () => ({ data: null, error: { code: "PGRST202" } })
  });
  const history = await lifecycle.getClosedSessions(DATE);
  assert.equal(history.available, false);
  assert.equal(history.sessions.length, 0);
});

test("worker is server-only, initially disabled, idempotent and threshold gated", () => {
  assert.match(SQL, /enabled boolean not null default false/i);
  assert.match(SQL, /values \(true, false\)/i);
  assert.match(SQL, /if not coalesce\(control\.enabled, false\) or control\.enabled_from is null then\s+return 0/i);
  assert.match(SQL, /candidate\.starts_at >= control\.enabled_from/i);
  assert.match(SQL, /candidate\.starts_at \+ interval '90 minutes' <= now\(\)/i);
  assert.match(RLS_SQL, /alter table private\.academic_v2_automation_control\s+enable row level security/i);
  assert.match(RLS_SQL, /alter table private\.academic_v2_closed_session_snapshots\s+enable row level security/i);
  assert.match(RLS_SQL, /alter table private\.academic_v2_attendance_audit\s+enable row level security/i);
  assert.match(SQL, /pg_catalog\.pg_try_advisory_xact_lock/i);
  assert.match(SQL, /on conflict \(class_number, starts_at\) do nothing/i);
  assert.match(SQL, /cron\.schedule\([\s\S]*'teacher-v2-auto-finalize'/i);
  assert.match(SQL, /revoke all on function private\.run_teacher_v2_auto_finalizations\(\)/i);
  assert.doesNotMatch(SQL, /create or replace function public\.get_teacher_lesson_plan\s*\(/i);
  assert.doesNotMatch(SQL, /create or replace function public\.finalize_teacher_lesson_session\s*\(/i);
});

test("absence is inferred only without activity; cancellations never become absent", () => {
  assert.match(SQL, /if not student\.is_cancelled then/i);
  assert.match(SQL, /if old_status = 'present' then/i);
  assert.match(SQL, /occurrence\.presented_lesson_number is not null/i);
  assert.match(SQL, /from private\.conversation_question_practice_log practice/i);
  assert.match(SQL, /new_status := 'absent'/i);
  assert.match(SQL, /private\.sync_academic_attendance\(/i);
  assert.match(SQL, /'automatic_absence'/i);
  assert.match(SQL, /snapshot_students := snapshot_students \|\| jsonb_build_array/i);
  assert.doesNotMatch(SQL, /(?:delete|update)\s+(?:from\s+)?(?:private\.student_regular_lesson_cancellations|public\.lesson_credits)/i);
});

test("manual participation and post-closure correction are administrative and audited", () => {
  assert.match(SQL, /create or replace function public\.mark_teacher_v2_participation/i);
  assert.match(SQL, /create or replace function public\.correct_teacher_v2_attendance/i);
  assert.match(SQL, /public\.is_teacher_admin\(\)/i);
  assert.match(SQL, /char_length\(normalized_reason\) < 8/i);
  assert.match(SQL, /'manual_participation'/i);
  assert.match(SQL, /'admin_correction'/i);
  assert.match(SQL, /academic_v2_attendance_audit/i);
  assert.match(SQL, /case when snapshot\.students is not null/i);
  assert.match(SQL, /coalesce\(occurrence\.attendance_status/i);
  assert.match(SQL, /from private\.academic_class_session_finalizations closed/i);
});

test("v2 supports manual attendance while automatic closure is still off and legacy remains active", () => {
  assert.match(APP, /SESSION_LIFECYCLE_ENABLED = true/);
  assert.match(APP, /PRESENTATION_REGISTRATION_ENABLED = true/);
  assert.match(APP, /QUESTION_RATINGS_ENABLED = true/);
  assert.match(APP, /state\.lifecycle\.getClosedSessions\(date\)/);
  assert.match(APP, /markParticipation\(item, control\)/);
  assert.match(APP, /correctAttendance\(item, control\)/);
  assert.match(APP, /renderClosedGroup\(container, group\)/);
  assert.match(PAGE, /session_lifecycle\.js\?v=20261022-etapa4/);
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/i);
  assert.match(OLD_PAGE, /src="\/roteiro-da-aula\/app\.js/);
  assert.doesNotMatch(OLD_PAGE, /roteiro-da-aula-v2/);
  assert.doesNotMatch(PAGE + APP + SOURCE, /\bonline\b/i);
});
