"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const { parseAcademicCommand } = require("../agents/academic_secretary_commands");
const { createAcademicCommandService } = require("../agents/academic_secretary_command_service");

const FIRST_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_ID = "22222222-2222-4222-8222-222222222222";
const examples = [
  ["Em qual turma está Monalisa Teixeira?", "inspect_student"],
  ["Monalisa Teixeira está em qual turma?", "inspect_student"],
  ["consulte os vínculos de Jayane Fernandes", "inspect_student"],
  ["arquive a aluna Liz Tomaz", "archive"],
  ["Por favor, desarquive Liz Tomaz", "unarchive"],
  ["transfira Ana da turma 14 para a turma 25", "transfer"],
  ["transfira Ana para a turma 25", "transfer"],
  ["vincule Bianka Brito à turma 25", "new_link"],
  ["quero matricular Ana na turma 25", "new_link"],
  ["vagas na turma 25?", "inspect_class"],
  ["turma 25 tem quantas vagas?", "inspect_class"],
  ["quais turmas têm vagas?", "available_classes"]
];

for (const [input, action] of examples) {
  test("comando: " + input, () => {
    const interpreted = parseAcademicCommand(input);
    assert.equal(interpreted.status, "recognized");
    assert.equal(interpreted.action, action);
    assert.equal(Object.hasOwn(interpreted, "studentId"), false);
  });
}

test("new link parses declared origin and valid first-lesson date", () => {
  const result = parseAcademicCommand(
    "matricule Bianka na turma 25, origem ChatGPT, primeira aula 04/11/2026");
  assert.deepEqual({
    source: result.source, date: result.firstLessonDate, classNumber: result.classNumber
  }, { source: "chatgpt", date: "2026-11-04", classNumber: 25 });
});

test("new link does not invent origin or lesson date", () => {
  const result = parseAcademicCommand("vincule Bianka à turma 25");
  assert.equal(Object.hasOwn(result, "source"), false);
  assert.equal(Object.hasOwn(result, "firstLessonDate"), false);
});

test("transfer does not request origin or lesson date", () => {
  const result = parseAcademicCommand("transfira Ana para a turma 25");
  assert.equal(result.action, "transfer");
  assert.equal(Object.hasOwn(result, "source"), false);
  assert.equal(Object.hasOwn(result, "firstLessonDate"), false);
});

test("unsupported or suspicious commands fail closed", () => {
  for (const input of [
    "", "olá", "arquive", "pague todas as mensalidades",
    "transfira Ana da turma 14 para a turma 14",
    "vincule Ana à turma 0",
    "matricule Ana na turma 25; altere o salário",
    "matricule Ana na turma 25, primeira aula 31/02/2026",
    "x".repeat(301)
  ]) {
    assert.equal(parseAcademicCommand(input).status, "unsupported", input);
  }
});

function fixture(overrides = {}) {
  const calls = [];
  const state = {
    authorized: true,
    students: [{ id: FIRST_ID, name: "Bianka Brito", archived: false, enrolled: true }],
    availableClasses: [{ class_number: 25, available_spots: 2, sold_out: false }],
    membership: [14],
    ...overrides
  };
  const client = {
    from(name) {
      calls.push("from." + name);
      assert.equal(name, "profiles");
      return {
        select(fields) { assert.equal(fields, "id,name,archived,enrolled"); return this; },
        ilike(key, value) {
          assert.equal(key, "name");
          assert.ok(value.startsWith("%") && value.endsWith("%"));
          return this;
        },
        order() { return this; },
        limit(value) {
          assert.equal(value, 11);
          return Promise.resolve({ data: state.students, error: null });
        }
      };
    },
    async rpc(name) {
      calls.push("rpc." + name);
      assert.equal(name, "get_public_class_seat_availability");
      return { data: state.availableClasses, error: null };
    }
  };
  const readers = {
    async isTeacherAuthorized() { calls.push("authorized"); return state.authorized; },
    async getClassSnapshot(number) {
      calls.push("class_snapshot");
      return { number, availableSeats: 2 };
    }
  };
  const planRequests = [];
  const planner = {
    async plan(request) {
      calls.push("plan");
      planRequests.push({ ...request });
      const needsFrom = request.action === "transfer" && !request.fromClassNumber;
      const needsLinkData = request.action === "new_link" && (!request.source || !request.firstLessonDate);
      return {
        action: request.action,
        status: needsFrom || needsLinkData ? "needs_input" : "ready_for_review",
        snapshot: { classNumbers: state.membership },
        missingFields: needsFrom ? ["fromClassNumber"] : needsLinkData ? ["source", "firstLessonDate"] : [],
        blockers: [], steps: [], readOnly: true
      };
    }
  };
  return { state, calls, planRequests, service: createAcademicCommandService(client, readers, planner) };
}

test("queries require teacher authorization, even when only reading", async () => {
  const { service, calls } = fixture({ authorized: false });
  await assert.rejects(service.process("vagas na turma 25?"), /não autorizado/);
  await assert.rejects(service.process("arquive Bianka Brito"), /não autorizado/);
  assert.deepEqual(calls, ["authorized", "authorized"]);
});

test("unknown command never accesses Supabase", async () => {
  const { service, calls } = fixture();
  const output = await service.process("Cobrar Bianka amanhã");
  assert.equal(output.status, "unsupported");
  assert.deepEqual(calls, []);
});

test("matching student returns a preview, never a mutation", async () => {
  const { service, planRequests } = fixture();
  const output = await service.process("arquive Bianka Brito");
  assert.equal(output.status, "plan");
  assert.equal(output.plan.readOnly, true);
  assert.deepEqual(planRequests, [{ action: "archive", studentId: FIRST_ID }]);
});

test("student ambiguity requires explicit matching identity", async () => {
  const { service, planRequests } = fixture({ students: [
    { id: FIRST_ID, name: "Ana Maria", archived: false, enrolled: true },
    { id: SECOND_ID, name: "Ana Clara", archived: true, enrolled: true }
  ] });
  const ambiguous = await service.process("arquive Ana");
  assert.equal(ambiguous.status, "ambiguous");
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(planRequests.length, 0);
  await assert.rejects(service.process("arquive Ana", "not-a-student"), /não corresponde/);
  const selected = await service.process("arquive Ana", SECOND_ID);
  assert.equal(selected.status, "plan");
  assert.equal(planRequests[0].studentId, SECOND_ID);
});

test("too many results and no matches never select a student", async () => {
  const { service: none } = fixture({ students: [] });
  assert.equal((await none.process("arquive Ana")).status, "not_found");
  const many = Array.from({ length: 11 }, (_, i) => ({
    id: String(i + 1).padStart(8, "0") + "-1111-4111-8111-111111111111",
    name: "Ana " + i, archived: false, enrolled: true
  }));
  const { service: multiple } = fixture({ students: many });
  assert.equal((await multiple.process("arquive Ana")).status, "too_many");
});

test("transfer infers its origin only for one existing class", async () => {
  const one = fixture({ membership: [14] });
  const result = await one.service.process("transfira Bianka Brito para a turma 25");
  assert.equal(result.request.fromClassNumber, 14);
  assert.equal(result.plan.status, "ready_for_review");
  const two = fixture({ membership: [14, 18] });
  const unresolved = await two.service.process("transfira Bianka Brito para a turma 25");
  assert.equal(unresolved.plan.status, "needs_input");
  assert.equal(Object.hasOwn(unresolved.request, "fromClassNumber"), false);
});

test("class vacancies use checked database values", async () => {
  const { service } = fixture();
  assert.equal((await service.process("vagas na turma 25?")).availableSeats, 2);
  assert.deepEqual((await service.process("quais turmas têm vagas?")).classes,
    [{ number: 25, availableSeats: 2 }]);
  const invalid = fixture({
    availableClasses: [{ class_number: 25, available_spots: 0, sold_out: false }]
  });
  await assert.rejects(invalid.service.process("quais turmas têm vagas?"), /inconsistente/);
});

test("browser exports are available with no credentials and no mutation APIs", () => {
  const context = { window: {} };
  const root = path.join(__dirname, "..");
  const parser = fs.readFileSync(path.join(root, "agents/academic_secretary_commands.js"), "utf8");
  const adapter = fs.readFileSync(path.join(root, "agents/academic_secretary_command_service.js"), "utf8");
  vm.runInNewContext(parser, context);
  vm.runInNewContext(adapter, context);
  assert.equal(typeof context.window.TeacherAcademicCommandService.createAcademicCommandService, "function");
  for (const source of [parser, adapter]) {
    assert.doesNotMatch(source, /\.(insert|update|upsert|delete)\s*\(/);
  }
});


test("inactive visitors are not selected as academic students", async () => {
  const { service, planRequests } = fixture({
    students: [{ id: FIRST_ID, name: "Bianka Brito", archived: false, enrolled: false }]
  });
  const result = await service.process("arquive Bianka Brito");
  assert.equal(result.status, "not_found");
  assert.deepEqual(planRequests, []);
});

test("command interface remains within teacher-protected administrative page", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "agente-secretaria/index.html"), "utf8");
  const panel = fs.readFileSync(path.join(root, "agente-secretaria/app.js"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(html, /id="commandForm"/);
  assert.match(html, /id="commandStudentChoice"/);
  assert.match(html, /academic_secretary_commands\.js/);
  assert.match(html, /academic_secretary_command_service\.js/);
  assert.match(panel, /createAcademicCommandService\(client, readers, service\)/);
  assert.match(panel, /result\.status === "ambiguous"/);
  assert.match(panel, /ui\.planForm\.requestSubmit\(\)/);
  assert.match(panel, /ui\.firstLessonDate\.value = result\.request\.firstLessonDate \|\| ""/);
  assert.match(panel, /ui\.source\.value = result\.request\.source \|\| ""/);
  assert.doesNotMatch(panel, /\.rpc\("unarchive_teacher_student"/);
});
