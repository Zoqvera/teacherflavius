"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const page = fs.readFileSync(path.join(ROOT, "o-que-fazer/index.html"), "utf8");
const studentApp = fs.readFileSync(path.join(ROOT, "o-que-fazer/app.js"), "utf8");
const workflowService = fs.readFileSync(path.join(ROOT, "academic_workflow_service.js"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261014162600_add_student_due_review_questions.sql"), "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/310_add_student_due_review_questions.sql"), "utf8"
);

function createElement(tagName) {
  return {
    tagName,
    className: "",
    dataset: {},
    textContent: "",
    disabled: false,
    children: [],
    set innerHTML(value) {
      this.children = [];
      this.html = value;
    },
    get innerHTML() {
      return this.html || "";
    },
    appendChild(child) {
      this.children.push(child);
    },
    setAttribute() {},
    addEventListener() {}
  };
}

async function loadStudentPage(reviews, reviewError = null) {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, createElement("div"));
    return elements.get(id);
  };
  const client = {
    async getMyActionPlan() {
      return { lesson: null, questions: [] };
    },
    async getMyReviewQuestions() {
      if (reviewError) throw reviewError;
      return reviews;
    }
  };
  const auth = {
    isConfigured: () => true,
    getSession: async () => ({ user: { id: "synthetic-student" } }),
    getClient: () => ({})
  };
  const window = {
    Auth: auth,
    SUPABASE_CONFIG: {},
    ResourceWaiter: { waitUntil: async () => true },
    AcademicWorkflowService: { create: () => client },
    ConversationQuestionCardRenderer: {
      create(question, options) {
        return { kind: "question-card", question, number: options.number };
      }
    },
    location: { href: "" }
  };
  const document = {
    getElementById,
    createElement,
    body: { classList: { remove() {} } }
  };

  vm.runInNewContext(studentApp, { window, document, console }, {
    filename: "o-que-fazer/app.js"
  });
  await new Promise((resolve) => setImmediate(resolve));
  return { getElementById };
}

test("review section comes before the full question catalog and uses the exact student guidance", () => {
  const reviewPosition = page.indexOf('id="reviewQuestionsTitle"');
  const catalogPosition = page.indexOf('id="questionsTitle"');
  assert.ok(reviewPosition >= 0 && reviewPosition < catalogPosition);
  assert.match(
    page,
    /Essas são perguntas que você já estudou, mas precisa melhorar suas respostas\. Estude mais uma vez e participe da aula para responder de novo\./
  );
  assert.match(page, /id="reviewQuestionList"/);
  assert.match(page, /id="actionQuestionList"/);
});

test("only the student's own due questions are exposed from private academic records", () => {
  assert.equal(migration, baseline);
  for (const sql of [migration, baseline]) {
    assert.match(sql, /public\.get_my_review_questions\(\)/);
    assert.match(sql, /caller_id uuid := auth\.uid\(\)/);
    assert.match(sql, /profile\.id = caller_id/);
    assert.match(sql, /profile\.enrolled/);
    assert.match(sql, /profile\.archived/);
    assert.match(sql, /practice\.student_id = caller_id/);
    assert.match(sql, /distinct on \(practice\.question_id\)/);
    assert.match(sql, /practice\.attendance_sequence desc/);
    assert.match(sql, /latest\.due_attendance_sequence <= next_attendance_sequence/);
    assert.match(sql, /private\.academic_planned_attendance_sequence/);
    assert.match(sql, /set search_path = ''/);
    assert.match(sql, /revoke execute on function public\.get_my_review_questions\(\) from public, anon/);
    assert.match(sql, /grant execute on function public\.get_my_review_questions\(\) to authenticated, service_role/);
  }
});

test("student service reads due questions without calling the teacher's privileged RPC", () => {
  assert.match(workflowService, /async function getMyReviewQuestions\(\)/);
  assert.match(workflowService, /supabase\.rpc\("get_my_review_questions"\)/);
  assert.match(workflowService, /return hydrateQuestions\(Array\.isArray\(reviews\) \? reviews : \[\]\)/);
  assert.match(studentApp, /service\.getMyReviewQuestions\(\)/);
  assert.doesNotMatch(studentApp, /getTeacherLessonPlan\(/);
});

test("only due reviews are rendered in the priority panel, without altering the full catalog", async () => {
  const questions = [
    { id: "due-1", text: "Where do you live?" },
    { id: "due-2", text: "What is your job?" }
  ];
  const { getElementById } = await loadStudentPage(questions);
  const reviewItems = getElementById("reviewQuestionList").children;
  assert.equal(reviewItems.length, 2);
  assert.deepEqual(reviewItems.map((item) => item.question.id), ["due-1", "due-2"]);
  assert.equal(getElementById("actionQuestionList").children.length, 1);
  assert.match(getElementById("reviewQuestionsStatus").textContent, /^$/);
});

test("empty review state is explicit, and review failure does not hide the question catalog", async () => {
  const emptyState = await loadStudentPage([]);
  assert.match(
    emptyState.getElementById("reviewQuestionList").children[0].textContent,
    /não tem perguntas programadas para revisão/
  );
  const previousError = console.error;
  console.error = () => {};
  try {
    const failedState = await loadStudentPage([], new Error("synthetic failure"));
    assert.match(
      failedState.getElementById("reviewQuestionsStatus").textContent,
      /Não foi possível carregar as revisões programadas/
    );
    assert.equal(failedState.getElementById("actionQuestionList").children.length, 1);
  } finally {
    console.error = previousError;
  }
});
