"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createWorkflow() {
  const calls = [];
  const context = { window: {} };
  const source = fs.readFileSync(
    path.join(__dirname, "../academic_workflow_service.js"),
    "utf8"
  );
  vm.runInNewContext(source, context);
  const service = context.window.AcademicWorkflowService.create({
    async rpc(name, payload) {
      calls.push({ name, payload });
      return { data: { ok: true }, error: null };
    }
  });
  return { service, calls };
}

const studentLesson = {
  entry_id: "entry-id",
  lesson_kind: "regular",
  lesson_number: 1
};

test("programa a apresentação da ocorrência sem registrar apresentação", async () => {
  const { service, calls } = createWorkflow();
  await service.setPlannedLesson(studentLesson, "2026-10-21", 2);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "set_teacher_planned_lesson");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)), {
    target_lesson_kind: "regular",
    target_entry_id: "entry-id",
    target_date: "2026-10-21",
    target_lesson_number: 2
  });
});

test("permite restaurar a sequência automática da ocorrência", async () => {
  const { service, calls } = createWorkflow();
  await service.setPlannedLesson(studentLesson, "2026-10-21", null);
  assert.equal(calls[0].payload.target_lesson_number, null);
});

test("rejeita apresentações fora da faixa sem enviar RPC", async () => {
  const { service, calls } = createWorkflow();
  await assert.rejects(
    service.setPlannedLesson(studentLesson, "2026-10-21", 75),
    /apresentação válida/i
  );
  await assert.rejects(
    service.setPlannedLesson(studentLesson, "2026-10-21", 0),
    /apresentação válida/i
  );
  assert.equal(calls.length, 0);
});

test("rejeita datas inválidas sem enviar RPC", async () => {
  const { service, calls } = createWorkflow();
  await assert.rejects(
    service.setPlannedLesson(studentLesson, "21/10/2026", 2),
    /Data da aula inválida/
  );
  assert.equal(calls.length, 0);
});
