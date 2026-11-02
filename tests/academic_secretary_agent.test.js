"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ACTIONS, createAcademicSecretaryAgent } = require("../agents/academic_secretary");

function setup(overrides = {}) {
  const calls = [];
  const defaults = {
    async isTeacherAuthorized() { calls.push("auth"); return true; },
    async getStudentSnapshot(id) {
      calls.push("student");
      return { id, archived: false, classNumbers: [14] };
    },
    async getClassSnapshot(number) {
      calls.push("class");
      return { number, availableSeats: 2 };
    }
  };
  const agent = createAcademicSecretaryAgent({ ...defaults, ...overrides });
  return { agent, calls };
}

const studentId = "student-001";

test("fails closed on missing adapters and unauthorized callers", async () => {
  assert.throws(() => createAcademicSecretaryAgent({}), /Dependência obrigatória/);
  const { agent, calls } = setup({
    async isTeacherAuthorized() { calls.push("auth"); return false; }
  });
  await assert.rejects(agent.plan({ action: ACTIONS.INSPECT_STUDENT, studentId }), /não autorizado/);
  assert.deepEqual(calls, ["auth"]);
});

test("inspect provides a limited read-only snapshot", async () => {
  const { agent } = setup();
  const plan = await agent.plan({ action: ACTIONS.INSPECT_STUDENT, studentId });
  assert.equal(plan.status, "ready_for_review");
  assert.equal(plan.readOnly, true);
  assert.deepEqual(plan.snapshot.classNumbers, [14]);
  assert.equal(plan.requiresAtomicExecution, false);
});

test("new links require declared origin and first lesson date", async () => {
  const { agent } = setup();
  const plan = await agent.plan({ action: ACTIONS.NEW_LINK, studentId, classNumber: 31 });
  assert.equal(plan.status, "needs_input");
  assert.deepEqual(plan.missingFields, ["source", "firstLessonDate"]);
  assert.equal(plan.requiresAtomicExecution, true);
  assert.equal(plan.readOnly, true);
});

test("new links normalize acquisition source and validate calendar dates", async () => {
  const { agent } = setup();
  const valid = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId, classNumber: 31,
    source: "Indicação", firstLessonDate: "2026-11-09"
  });
  assert.equal(valid.status, "ready_for_review");
  assert.equal(valid.canonicalSource, "referral");
  const invalid = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId, classNumber: 31,
    source: "Google", firstLessonDate: "2026-02-30"
  });
  assert.equal(invalid.status, "blocked");
});

test("other acquisition origins require short descriptions", async () => {
  const { agent } = setup();
  const missing = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId, classNumber: 31,
    source: "Outras", firstLessonDate: "2026-11-09"
  });
  assert.deepEqual(missing.missingFields, ["sourceDetail"]);
  const invalid = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId, classNumber: 31,
    source: "other", sourceDetail: "x".repeat(121), firstLessonDate: "2026-11-09"
  });
  assert.equal(invalid.status, "blocked");
});

test("transfers never prompt for acquisition or first lesson", async () => {
  const { agent } = setup();
  const result = await agent.plan({
    action: ACTIONS.TRANSFER, studentId, classNumber: 31, fromClassNumber: 14
  });
  assert.equal(result.status, "ready_for_review");
  assert.deepEqual(result.missingFields, []);
  assert.ok(result.steps.some(step => step.includes("créditos")));
  assert.ok(result.steps.some(step => step.includes("outros vínculos")));
});

test("ambiguous transfers require an origin class only", async () => {
  const { agent } = setup({
    async getStudentSnapshot(id) { return { id, archived: false, classNumbers: [14, 22] }; }
  });
  const result = await agent.plan({ action: ACTIONS.TRANSFER, studentId, classNumber: 31 });
  assert.deepEqual(result.missingFields, ["fromClassNumber"]);
});

test("classes without seats or existing memberships are blocked", async () => {
  const { agent } = setup({
    async getClassSnapshot(number) { return { number, availableSeats: 0 }; }
  });
  const result = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId, classNumber: 14,
    source: "facebook", firstLessonDate: "2026-11-09"
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockers.length, 2);
});

test("third simultaneous class links are blocked", async () => {
  const { agent } = setup({
    async getStudentSnapshot(id) { return { id, archived: false, classNumbers: [14, 22] }; }
  });
  const result = await agent.plan({
    action: ACTIONS.NEW_LINK, studentId, classNumber: 31,
    source: "instagram", firstLessonDate: "2026-11-09"
  });
  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /dois vínculos/);
});

test("archive and unarchive preserve billing rules without writing", async () => {
  const active = setup();
  const archive = await active.agent.plan({ action: ACTIONS.ARCHIVE, studentId });
  assert.equal(archive.status, "ready_for_review");
  assert.equal(archive.readOnly, true);
  assert.match(archive.steps.join(" "), /suspensão das próximas cobranças/);
  const archived = setup({
    async getStudentSnapshot(id) { return { id, archived: true, classNumbers: [] }; }
  });
  const restore = await archived.agent.plan({ action: ACTIONS.UNARCHIVE, studentId });
  assert.equal(restore.status, "ready_for_review");
  assert.match(restore.steps.join(" "), /reativação das próximas mensalidades/);
  assert.match(restore.steps.join(" "), /Não criar vínculo/);
});

test("incomplete or stale snapshots fail closed", async () => {
  const wrongStudent = setup({
    async getStudentSnapshot() { return { id: "another", archived: false, classNumbers: [] }; }
  });
  await assert.rejects(
    wrongStudent.agent.plan({ action: ACTIONS.ARCHIVE, studentId }), /incompleto ou inconsistente/
  );
  const missingSeats = setup({
    async getClassSnapshot(number) { return { number, availableSeats: null }; }
  });
  await assert.rejects(
    missingSeats.agent.plan({ action: ACTIONS.NEW_LINK, studentId, classNumber: 31 }),
    /não foi verificada/
  );
});
