"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { parseAcademicCommand } = require("../agents/academic_secretary_commands");
const { createAcademicCommandService } = require("../agents/academic_secretary_command_service");

const STUDENT_ID = "11111111-1111-4111-8111-111111111111";
const weekdayCases = [
  ["segunda-feira", 1], ["terça-feira", 2], ["terca", 2],
  ["quarta", 3], ["quinta-feira", 4], ["sexta", 5],
  ["sábado", 6], ["sabado", 6], ["domingo", 7]
];

for (const [day, number] of weekdayCases) {
  test("dia da semana " + day + " usa numeração ISO", () => {
    const parsed = parseAcademicCommand("vagas na turma de " + day + " às 18h?");
    assert.equal(parsed.status, "recognized");
    assert.equal(parsed.action, "inspect_class");
    assert.equal(parsed.classSchedule.classWeekday, number);
    assert.equal(parsed.classSchedule.classStartTime, "18:00:00");
  });
}

test("minutos, acentuação e comando de transferência são reconhecidos", () => {
  const parsed = parseAcademicCommand("transfira Ana para a turma de quarta-feira às 20:30");
  assert.equal(parsed.action, "transfer");
  assert.equal(parsed.studentName, "Ana");
  assert.deepEqual(parsed.classSchedule, { classWeekday: 3, classStartTime: "20:30:00" });
  assert.equal(Object.hasOwn(parsed, "source"), false);
  assert.equal(Object.hasOwn(parsed, "firstLessonDate"), false);
});

test("novo vínculo por horário preserva origem e primeira aula declaradas", () => {
  const parsed = parseAcademicCommand(
    "vincule Ana à turma de quinta às 18h, origem Instagram, primeira aula 05/11/2026"
  );
  assert.equal(parsed.action, "new_link");
  assert.equal(parsed.classSchedule.classWeekday, 4);
  assert.equal(parsed.source, "instagram");
  assert.equal(parsed.firstLessonDate, "2026-11-05");
});

test("rejeita datas inválidas e horários desconhecidos sem adivinhar", () => {
  for (const phrase of [
    "matricule Ana na turma de quinta às 18h, primeira aula 31/02/2026",
    "vagas na turma de quarta às 25h",
    "matricule Ana na turma de quinta às 18h; execute outro comando"
  ]) {
    assert.equal(parseAcademicCommand(phrase).status, "unsupported", phrase);
  }
});

function mockService(options = {}) {
  const log = [];
  const classes = options.classes || [{
    class_number: 30, class_name: "Quinta 18h", class_weekday: 4,
    class_start_time: "18:00:00", class_type: "quintet", is_active: true
  }];
  const people = [{
    id: STUDENT_ID, name: "Ana Pereira", archived: false, enrolled: true
  }];
  const client = {
    from(table) {
      log.push(table);
      if (table === "teacher_classes") {
        const query = {
          select(fields) {
            assert.equal(fields,
              "class_number,class_name,class_weekday,class_start_time,class_type,is_active");
            return this;
          },
          eq(column, value) {
            log.push(column + ":" + value);
            return this;
          },
          order() { return this; },
          limit(value) {
            assert.equal(value, 11);
            return Promise.resolve({ data: classes, error: null });
          }
        };
        return query;
      }
      assert.equal(table, "profiles");
      return {
        select() { return this; },
        ilike() { return this; },
        order() { return this; },
        limit() { return Promise.resolve({ data: people, error: null }); }
      };
    },
    rpc() { throw new Error("RPC não esperada."); }
  };
  const readers = {
    async isTeacherAuthorized() {
      log.push("authorized");
      return options.authorized !== false;
    },
    async getClassSnapshot(number) {
      log.push("read_class:" + number);
      return { number, availableSeats: 2 };
    }
  };
  const planned = [];
  const planner = {
    async plan(request) {
      planned.push({ ...request });
      return {
        status: "ready_for_review", readOnly: true, action: request.action,
        snapshot: { classNumbers: [22] }, blockers: [], steps: [], missingFields: []
      };
    }
  };
  return { service: createAcademicCommandService(client, readers, planner), log, planned };
}

test("horário único resolve número real da turma, sem escrita", async () => {
  const { service, planned } = mockService();
  const result = await service.process("vincule Ana Pereira à turma de quinta às 18h");
  assert.equal(result.status, "plan");
  assert.equal(result.request.classNumber, 30);
  assert.equal(result.plan.readOnly, true);
  assert.equal(planned.length, 1);
});

test("consultas de vagas por horário dependem da autorização administrativa", async () => {
  const { service, log } = mockService({ authorized: false });
  await assert.rejects(service.process("vagas na turma de quinta às 18h?"), /não autorizado/);
  assert.equal(log.includes("teacher_classes"), false);
});

test("horário com várias turmas exige seleção explícita e revalidação", async () => {
  const { service, planned } = mockService({
    classes: [
      { class_number: 30, class_name: "Quinta 18h A", class_weekday: 4,
        class_start_time: "18:00:00", class_type: "quintet", is_active: true },
      { class_number: 31, class_name: "Quinta 18h B", class_weekday: 4,
        class_start_time: "18:00:00", class_type: "quintet", is_active: true }
    ]
  });
  const command = "transfira Ana Pereira para a turma de quinta às 18h";
  const ambiguous = await service.process(command);
  assert.equal(ambiguous.status, "class_ambiguous");
  assert.equal(ambiguous.candidates.length, 2);
  assert.equal(planned.length, 0);
  await assert.rejects(service.process(command, null, 999), /não corresponde/);
  const selected = await service.process(command, null, 31);
  assert.equal(selected.status, "plan");
  assert.equal(selected.request.classNumber, 31);
  assert.equal(selected.request.fromClassNumber, 22);
});

test("sem turma elegível, comando não prepara matrícula", async () => {
  const { service, planned } = mockService({ classes: [] });
  const result = await service.process("vincule Ana Pereira à turma de quinta às 18h");
  assert.equal(result.status, "class_not_found");
  assert.equal(planned.length, 0);
});

test("resposta inconsistente do Supabase bloqueia interpretação", async () => {
  const { service } = mockService({ classes: [{
    class_number: 30, class_name: "Inativa", class_weekday: 4,
    class_start_time: "18:00:00", class_type: "quintet", is_active: false
  }] });
  await assert.rejects(service.process("vagas na turma de quinta às 18h?"), /inconsistentes/);
});

test("interface expõe seleção da turma sem execução automática", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "agente-secretaria/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "agente-secretaria/app.js"), "utf8");
  assert.match(html, /id="commandClassChoice"/);
  assert.match(html, /id="commandClassContinue" type="button" disabled/);
  assert.match(html, /noindex,nofollow/);
  assert.match(app, /result\.status === "class_ambiguous"/);
  assert.match(app, /commandService\.process\(text, chosenStudentId, chosenClassNumber\)/);
  assert.doesNotMatch(app, /rpc\("add_teacher_class_student"/);
  assert.doesNotMatch(app, /rpc\("remove_teacher_class_student"/);
});
