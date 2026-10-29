const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const SERVICE_SOURCE = fs.readFileSync(path.join(
  ROOT, "roteiro-da-aula-v2/presentation_registration.js"
), "utf8");
const APP_SOURCE = fs.readFileSync(path.join(
  ROOT, "roteiro-da-aula-v2/app.js"
), "utf8");
const PAGE_SOURCE = fs.readFileSync(path.join(
  ROOT, "roteiro-da-aula-v2/index.html"
), "utf8");
const LEGACY_PAGE = fs.readFileSync(path.join(
  ROOT, "roteiro-da-aula-legado/index.html"
), "utf8");
const ACADEMIC_SOURCE = fs.readFileSync(path.join(
  ROOT, "academic_workflow_service.js"
), "utf8");

const context = vm.createContext({ window: {} });
vm.runInContext(SERVICE_SOURCE, context);
const registration = context.window.TeacherPresentationRegistration;
const DATE = "2026-10-22";
const ENTRY = "11111111-1111-4111-8111-111111111111";
const STUDENT = "22222222-2222-4222-8222-222222222222";
const OCCURRENCE = "33333333-3333-4333-8333-333333333333";

function lesson(overrides = {}) {
  return Object.assign({
    entry_id: ENTRY,
    student_id: STUDENT,
    lesson_kind: "regular",
    lesson_number: 4,
    lesson_status: "prepared",
    attendance_status: "scheduled",
    starts_at: "2026-10-22T13:00:00+00:00"
  }, overrides);
}

function confirmation(number = 4) {
  return { ok: true, lesson_number: number, occurrence_id: OCCURRENCE };
}

test("presentation domain allows scheduled and present students with a planned lesson", () => {
  assert.equal(registration.canRegister(lesson()), true);
  assert.equal(registration.canRegister(lesson({ attendance_status: "present" })), true);
  assert.equal(registration.canRegister(lesson({ lesson_number: 74 })), true);
  assert.equal(registration.canRegister(lesson({ lesson_number: 75 })), false);
  assert.equal(registration.canRegister(lesson({ lesson_number: null })), false);
  assert.equal(registration.canRegister(lesson({ lesson_status: "presented" })), false);
});

test("cancelled or absent students cannot register a presentation", () => {
  ["cancelled", "cancelled_finalized", "absent"].forEach((status) => {
    assert.equal(registration.canRegister(lesson({ attendance_status: status })), false);
  });
  assert.equal(registration.canRegister(lesson({ entry_id: "invalid" })), false);
  assert.equal(registration.canRegister(lesson({ lesson_kind: "unknown" })), false);
});

test("the registration rejects invalid dates and mismatched class occurrence", () => {
  const service = registration.create({ markLessonPresented: async () => confirmation() });
  assert.throws(() => service.register(lesson(), "2026-10-23"), /outra data/i);
  assert.throws(() => service.register(lesson(), "2026/10/22"), /data da aula inválida/i);
  assert.throws(() => service.register(lesson({ starts_at: "invalid" }), DATE),
    /horário da aula inválido/i);
});

test("a valid registration uses the existing atomic service and returns server confirmation", async () => {
  let calls = 0;
  const service = registration.create({
    async markLessonPresented(item, date) {
      calls += 1;
      assert.equal(item.lesson_kind, "regular");
      assert.equal(item.entry_id, ENTRY);
      assert.equal(item.lesson_number, 4);
      assert.equal(date, DATE);
      return confirmation();
    }
  });
  const result = await service.register(lesson(), DATE);
  assert.equal(result.ok, true);
  assert.equal(result.lesson_number, 4);
  assert.equal(calls, 1);
});

test("simultaneous and repeated requests for the same presentation have one write", async () => {
  let calls = 0;
  let finish;
  const rpc = new Promise((resolve) => { finish = resolve; });
  const service = registration.create({
    markLessonPresented() { calls += 1; return rpc; }
  });
  const first = service.register(lesson(), DATE);
  const second = service.register(lesson(), DATE);
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(confirmation());
  await Promise.all([first, second]);
  const replay = await service.register(lesson(), DATE);
  assert.equal(replay.ok, true);
  assert.equal(calls, 1);
});

test("failed registration does not report success and may be retried", async () => {
  let calls = 0;
  const service = registration.create({
    async markLessonPresented() {
      calls += 1;
      if (calls === 1) throw new Error("Server unavailable");
      return confirmation();
    }
  });
  await assert.rejects(service.register(lesson(), DATE), /Server unavailable/);
  const result = await service.register(lesson(), DATE);
  assert.equal(result.ok, true);
  assert.equal(calls, 2);
});

test("an incomplete server acknowledgement is never treated as success", async () => {
  const cases = [null, { ok: false }, { ok: true, lesson_number: 5, occurrence_id: OCCURRENCE },
    { ok: true, lesson_number: 4 }];
  for (const reply of cases) {
    const service = registration.create({
      markLessonPresented: async () => reply
    });
    await assert.rejects(service.register(lesson(), DATE), /não foi confirmado/i);
  }
});

test("presentation records enabled exclusively in v2 and the existing route is unchanged", () => {
  assert.match(PAGE_SOURCE, /presentation_registration\.js\?v=20261029-cancel-1/);
  assert.match(APP_SOURCE, /PRESENTATION_REGISTRATION_ENABLED = true/);
  assert.match(APP_SOURCE, /state\.registration\.register\(item, classDate\)/);
  assert.match(APP_SOURCE, /item\.lesson_status = "presented"/);
  assert.match(APP_SOURCE, /item\.attendance_status = "present"/);
  assert.match(APP_SOURCE, /readonlyAction\("REGISTRAR APRESENTAÇÃO"\)/);
  assert.match(LEGACY_PAGE, /src="\/roteiro-da-aula\/app\.js/);
  assert.doesNotMatch(LEGACY_PAGE, /roteiro-da-aula-v2/);
  assert.match(ACADEMIC_SOURCE, /supabase\.rpc\("mark_teacher_lesson_presented"/);
  assert.doesNotMatch(SERVICE_SOURCE + APP_SOURCE + PAGE_SOURCE, /\bonline\b/i);
});
