const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const MIGRATION = read("supabase/migrations/20261029220440_cancel_teacher_presentation_v2.sql");
const ACTIVE_INDEX = read("roteiro-da-aula/index.html");
const APP = read("roteiro-da-aula-v2/app.js");
const STYLES = read("roteiro-da-aula-v2/styles.css");
const CANCELLATION = read("roteiro-da-aula-v2/presentation_cancellation.js");
const REGISTRATION = read("roteiro-da-aula-v2/presentation_registration.js");

function load(source, name) {
  const context = vm.createContext({
    window: {}, Intl, Date, Map, Promise, Number, String, Object
  });
  vm.runInContext(source, context);
  return context.window[name];
}

const student = {
  lesson_kind: "regular",
  entry_id: "11111111-1111-4111-8111-111111111111",
  student_id: "22222222-2222-4222-8222-222222222222",
  starts_at: "2026-10-29T21:00:00Z",
  lesson_number: 1,
  lesson_status: "presented",
  attendance_status: "present"
};

const classDate = "2026-10-29";

test("cancel button appears in active and closed presentations", () => {
  assert.match(APP, /CANCELAR APRESENTAÇÃO/);
  assert.match(APP, /actions\.appendChild\(presentationCancellationAction\(item\)\)/);
  assert.match(APP, /cancel_teacher_lesson_presentation_v2/);
  assert.match(ACTIVE_INDEX, /presentation_cancellation\.js/);
  assert.match(ACTIVE_INDEX, /app\.js\?v=20261029-inline-actions-1/);
  assert.doesNotMatch(APP, /\bonline\b/i);
});

test("presentation controls share a row and cancellation follows a confirmed presentation", () => {
  assert.match(APP, /const actions = presentationActions\(item, presentation\)/);
  assert.match(APP, /if \(isPresented\) \{\s*actions\.appendChild\(registeredPresentationAction\(\)\)/);
  assert.match(APP, /actions\.appendChild\(presentationCopyAction\(presentation\)\)/);
  assert.match(APP, /if \(isPresented && window\.TeacherPresentationCancellation\.canCancel\(item\)\)/);
  assert.match(APP, /control\.disabled = true;\s*control\.title = "Apresentação já registrada\."/);
  assert.match(STYLES, /\.workspace-presentation-actions \{[\s\S]*?grid-auto-flow: column/);
  assert.match(STYLES, /\.workspace-presentation-actions \.academic-button \{/);
});

test("only valid, already presented lessons can be cancelled", () => {
  const service = load(CANCELLATION, "TeacherPresentationCancellation");
  assert.equal(service.canCancel(student), true);
  assert.equal(service.canCancel({ ...student, lesson_status: "planned" }), false);
  assert.equal(service.canCancel({ ...student, attendance_status: "cancelled" }), false);
  assert.equal(service.canCancel({ ...student, entry_id: "invalid" }), false);
});

test("cancellation requires date, explicit attendance and reason", async () => {
  const service = load(CANCELLATION, "TeacherPresentationCancellation");
  let calls = 0;
  const client = service.create({
    async cancelPresentation() {
      calls++;
      return {
        ok: true, occurrence_id: "33333333-3333-4333-8333-333333333333",
        cancelled_lesson_number: 1, attendance_status: "absent"
      };
    }
  });
  assert.throws(() => client.cancel(student, classDate, "absent", "short"));
  assert.throws(() => client.cancel(student, "2026-10-30", "absent", "Erro de registro."));
  assert.throws(() => client.cancel(student, classDate, "scheduled", "Erro de registro."));
  assert.equal(calls, 0);
  const result = await client.cancel(student, classDate, "absent", "Erro de registro.");
  assert.equal(result.attendance_status, "absent");
  assert.equal(calls, 1);
});

test("concurrent cancel requests are deduplicated", async () => {
  const service = load(CANCELLATION, "TeacherPresentationCancellation");
  let calls = 0;
  const client = service.create({
    async cancelPresentation() {
      calls++;
      return {
        ok: true, occurrence_id: "33333333-3333-4333-8333-333333333333",
        cancelled_lesson_number: 1, attendance_status: "present"
      };
    }
  });
  await Promise.all([
    client.cancel(student, classDate, "present", "Registro incorreto."),
    client.cancel(student, classDate, "present", "Registro incorreto.")
  ]);
  assert.equal(calls, 1);
});

test("re-registration can invalidate a previous successful click", () => {
  assert.match(REGISTRATION, /function invalidate\(item, classDate\)/);
  assert.match(REGISTRATION, /confirmed\.delete\(registrationKey\(item, classDate\)\)/);
  assert.match(APP, /state\.registration\.invalidate\(item, classDate\)/);
});

test("transaction is admin-only, audit-logged and does not wipe independent progress", () => {
  assert.match(MIGRATION, /auth\.uid\(\) is null or not coalesce\(public\.is_teacher_admin\(\), false\)/);
  assert.match(MIGRATION, /pg_catalog\.pg_advisory_xact_lock\(20261022, 4\)/);
  assert.match(MIGRATION, /for update;/i);
  assert.match(MIGRATION, /private\.sync_academic_attendance\(/);
  assert.match(MIGRATION, /private\.academic_v2_attendance_audit/);
  assert.match(MIGRATION, /and not exists \(/i);
  assert.match(MIGRATION, /grant execute on function public\.cancel_teacher_lesson_presentation_v2/);
  assert.match(MIGRATION, /get_teacher_v2_closed_sessions/);
});
