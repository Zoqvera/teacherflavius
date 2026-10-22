const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

const context = vm.createContext({ window: {} });
vm.runInContext(read("roteiro-da-aula-v2/model.js"), context);
const model = context.window.TeacherWorkspaceModel;
const app = read("roteiro-da-aula-v2/app.js");
const page = read("roteiro-da-aula-v2/index.html");
const currentPage = read("roteiro-da-aula/index.html");

test("preview stays isolated, private to search engines and linked to the active teacher page", () => {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(page, /href="\/roteiro-da-aula\/"/);
  assert.match(page, /roteiro-da-aula-v2\/app\.js/);
  assert.match(page, /roteiro-da-aula-v2\/model\.js/);
  assert.match(currentPage, /src="\/roteiro-da-aula\/app\.js/);
  assert.doesNotMatch(currentPage, /roteiro-da-aula-v2/);
});

test("preview requires an authenticated teacher and does not perform lesson mutations", () => {
  assert.match(app, /rpc\("is_teacher_admin"\)/);
  assert.match(app, /permission\.data !== true/);
  assert.match(app, /readonlyAction\("REGISTRAR APRESENTAÇÃO"\)/);
  assert.match(app, /\["BOM", "MÉDIO", "MELHORAR"\]/);
  assert.match(app, /control\.disabled = true/);
  assert.doesNotMatch(app, /\.setAttendance\(|\.markLessonPresented\(|\.rateQuestion\(/);
  assert.doesNotMatch(app, /\.insert\(|\.update\(|\.delete\(/);
  assert.doesNotMatch(page + app, /\bonline\b/i);
});

test("class groups preserve distinct times and keep cancelled students visible", () => {
  const scheduled = {
    class_number: 29, starts_at: "2026-10-22T13:00:00Z",
    student_name: "Ana", attendance_status: "scheduled",
    lesson_status: "planned", today_questions: [{}]
  };
  const cancelled = Object.assign({}, scheduled, {
    student_name: "Bruna", attendance_status: "cancelled"
  });
  const nextTime = Object.assign({}, scheduled, {
    student_name: "Carla", starts_at: "2026-10-22T16:00:00Z"
  });
  const groups = model.groupByClass([cancelled, nextTime, scheduled]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].students[0].student_name, "Ana");
  assert.equal(groups[0].students[1].student_name, "Bruna");
  assert.equal(model.classSummary(groups[0]).cancelled, 1);
  assert.equal(model.classSummary(groups[0]).total, 1);
  assert.equal(model.classSummary(groups[0]).studiedToday, 1);
});

test("studied-history section combines prior questions with today's questions", () => {
  const catalog = vm.runInContext("new Map([[2, { display_order: 2, text: 'How are you?' }], [4, { display_order: 4, text: 'How old are you?' }]])", context);
  const questions = model.questionsForStudent({
    previously_studied_numbers: [4, 2, 2],
    today_questions: [{ id: "q5", display_order: 5, text: "What do you do?" }],
    review_questions: [{ id: "q2", display_order: 2 }]
  }, catalog);
  assert.equal(questions.all.map((question) => question.display_order).join(","), "2,4,5");
  assert.equal(questions.today.length, 1);
  assert.equal(questions.review.length, 1);
  assert.equal(model.normalizeNumbers([2, 1, 2, 0, -1]).join(","), "1,2");
});
