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
  path.join(ROOT, "supabase/migrations/20261014194243_add_student_due_review_questions.sql"), "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/310_add_student_due_review_questions.sql"), "utf8"
);
const actionPlanMigration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261014201405_expose_study_button_marker.sql"), "utf8"
);
const actionPlanBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/390_expose_study_button_marker.sql"), "utf8"
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
    handlers: {},
    setAttribute() {},
    addEventListener(event, callback) {
      this.handlers[event] = callback;
    }
  };
}

async function loadStudentPage(reviews, reviewError = null, planError = null, actionPlan = null) {
  const elements = new Map();
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, createElement("div"));
    return elements.get(id);
  };
  const client = {
    async getMyActionPlan() {
      if (planError) throw planError;
      return actionPlan || { lesson: null, questions: [] };
    },
    async markQuestionStudied(questionId) {
      const question = actionPlan?.questions?.find((item) => item.id === questionId);
      if (question) question.marked_studied = true;
      return { ok: true };
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

test("review priorities remain available when the general action plan cannot load", async () => {
  const savedError = console.error;
  console.error = () => {};
  try {
    const state = await loadStudentPage(
      [{ id: "due-1", text: "What time do you wake up?" }],
      null,
      new Error("Synthetic action-plan failure")
    );
    assert.equal(state.getElementById("reviewQuestionList").children.length, 1);
    assert.match(
      state.getElementById("actionPlanStatus").textContent,
      /Não foi possível carregar seu plano de preparação/
    );
  } finally {
    console.error = savedError;
  }
});

test("study catalog contains only questions without the explicit study-button marker", async () => {
  const actionPlan = {
    lesson: null,
    questions: [
      { id: "new-1", text: "What do you do?", marked_studied: false, studied: false, worked: false },
      { id: "clicked-1", text: "Where are you from?", marked_studied: true, studied: true, worked: false },
      { id: "clicked-worked", text: "Are you married?", marked_studied: true, studied: false, worked: true },
      { id: "worked-unclicked", text: "Do you cook?", marked_studied: false, studied: false, worked: true }
    ]
  };
  const state = await loadStudentPage([], null, null, actionPlan);
  const items = state.getElementById("actionQuestionList").children;

  assert.deepEqual(items.map((item) => item.children[0].question.id), [
    "new-1", "worked-unclicked"
  ]);
  assert.deepEqual(items.map((item) => item.children[0].number), [1, 2]);
  assert.equal(items[0].children[1].children[0].disabled, false);
  assert.equal(items[1].children[1].children[0].disabled, true);
});

test("clicked question disappears immediately after successful study registration", async () => {
  const actionPlan = {
    lesson: null,
    questions: [
      { id: "a", text: "Do you study?", marked_studied: false, studied: false, worked: false },
      { id: "b", text: "Do you work?", marked_studied: false, studied: false, worked: false }
    ]
  };
  const state = await loadStudentPage([], null, null, actionPlan);
  const initial = state.getElementById("actionQuestionList").children;

  initial[0].children[1].children[0].handlers.click();
  await new Promise((resolve) => setImmediate(resolve));

  const remaining = state.getElementById("actionQuestionList").children;
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].children[0].question.id, "b");
  assert.equal(state.getElementById("reviewQuestionList").children.length, 1);
});

test("no marked questions remain visible and the empty state is explicit", async () => {
  const state = await loadStudentPage([], null, null, {
    lesson: null,
    questions: [
      { id: "already-clicked", marked_studied: true, studied: false, worked: true }
    ]
  });
  const visible = state.getElementById("actionQuestionList").children;
  assert.equal(visible.length, 1);
  assert.match(visible[0].textContent, /já marcou todas as perguntas como estudadas/);
});

test("missing explicit marker never exposes a question as pending", async () => {
  const state = await loadStudentPage([], null, null, {
    lesson: null,
    questions: [{ id: "legacy", studied: false, worked: false }]
  });
  assert.equal(state.getElementById("actionQuestionList").children.length, 0);
  assert.match(
    state.getElementById("questionsStatus").textContent,
    /Não foi possível verificar quais perguntas ainda faltam estudar/
  );
});

test("action plan adds a separate permanent click marker without changing worked semantics", () => {
  assert.equal(actionPlanMigration, actionPlanBaseline);
  assert.match(actionPlanMigration, /public\.get_my_action_plan\(\)/);
  assert.match(actionPlanMigration, /auth\.uid\(\)/);
  assert.match(actionPlanMigration, /from private\.student_question_studies study/);
  assert.match(actionPlanMigration, /study\.student_id = caller_id/);
  assert.match(actionPlanMigration, /'marked_studied', question\.marked_studied/);
  assert.match(actionPlanMigration, /'studied', question\.studied/);
  assert.match(actionPlanMigration, /'worked', question\.worked/);
  assert.match(actionPlanMigration, /set search_path = ''/);
  assert.match(actionPlanMigration, /revoke execute on function public\.get_my_action_plan\(\) from public, anon/);
  assert.match(actionPlanMigration, /grant execute on function public\.get_my_action_plan\(\) to authenticated, service_role/);
  assert.doesNotMatch(actionPlanMigration, /mark_my_questions_studied\(/);
  assert.doesNotMatch(actionPlanMigration, /(?:insert into|update public\.|delete from|drop table)/i);
});
