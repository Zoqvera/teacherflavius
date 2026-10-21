"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const controller = fs.readFileSync(
  path.join(__dirname, "..", "conversation-questions/app.js"), "utf8"
);
const page = fs.readFileSync(
  path.join(__dirname, "..", "conversation-questions/index.html"), "utf8"
);

function element(tag = "div") {
  return {
    tagName: tag,
    children: [],
    className: "",
    dataset: {},
    hidden: false,
    disabled: false,
    attributes: {},
    handlers: {},
    _text: "",
    get textContent() { return this._text; },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    appendChild(node) { this.children.push(node); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, handler) { this.handlers[name] = handler; }
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function startPage({
  questions = [],
  progress = [],
  teacher = false,
  planError = null,
  writeError = null
} = {}) {
  const nodes = new Map();
  const document = {
    readyState: "complete",
    body: { classList: { remove() {} } },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
    createElement: element,
    createElementNS: (_namespace, tag) => element(tag)
  };
  const studied = [];
  const currentProgress = progress.map((item) => Object.assign({}, item));
  const catalog = {
    async getStudentProfile() {
      return { enrolled: true, archived: false };
    },
    async listQuestions() { return questions; },
    async listStudentCompletions() { return []; },
    async moveQuestion() {},
    async addQuestion() { throw new Error("Should not add questions"); }
  };
  const academic = {
    async getMyActionPlan() {
      if (planError) throw planError;
      return { questions: currentProgress };
    },
    async markQuestionStudied(id) {
      if (writeError) throw writeError;
      studied.push(id);
      const item = currentProgress.find((question) => question.id === id);
      if (item) item.marked_studied = true;
      return { ok: true };
    }
  };
  const window = {
    location: { pathname: "/conversation-questions/", href: "" },
    ResourceWaiter: { waitUntil: async () => true },
    Auth: {
      getSession: async () => ({ user: { id: "student-1" } }),
      getClient: () => ({}),
      isTeacherAdmin: async () => teacher
    },
    ConversationQuestionsService: {
      create: () => catalog,
      completionKey: (id, userId) => id + ":" + userId
    },
    AcademicWorkflowService: { create: () => academic },
    ConversationQuestionCardRenderer: {
      create(question) {
        const card = element("article");
        card.questionId = question.id;
        return card;
      }
    }
  };

  vm.runInNewContext(controller, { window, document, console: { error() {} } }, {
    filename: "conversation-questions/app.js"
  });
  await flush();

  return {
    studied,
    node: document.getElementById.bind(document),
    cards: () => document.getElementById("conversationQuestionList").children,
    button: (index) => document.getElementById("conversationQuestionList")
      .children[index].children[1].children[0]
  };
}

test("the student catalog loads the same academic study service as the second part", () => {
  assert.match(page, /academic_workflow_service\.js\?v=/);
  assert.match(page, /conversation-questions\/app\.js\?v=20261019-study-buttons-1/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
});

test("student catalog shows available, studied and worked questions distinctly", async () => {
  const state = await startPage({
    questions: [{ id: "pending" }, { id: "marked" }, { id: "worked" }],
    progress: [
      { id: "pending", marked_studied: false, studied: false, worked: false },
      { id: "marked", marked_studied: true, studied: true, worked: false },
      { id: "worked", marked_studied: false, studied: false, worked: true }
    ]
  });
  assert.equal(state.cards().length, 3);
  assert.equal(state.button(0).textContent, "ESTUDEI A PERGUNTA");
  assert.equal(state.button(0).disabled, false);
  assert.equal(state.button(1).textContent, "PERGUNTA ESTUDADA");
  assert.equal(state.button(1).disabled, true);
  assert.equal(state.button(2).textContent, "PERGUNTA JÁ TRABALHADA");
  assert.equal(state.button(2).disabled, true);
});

test("successful student click persists and disables the corresponding catalog control", async () => {
  const state = await startPage({
    questions: [{ id: "q1" }, { id: "q2" }],
    progress: [
      { id: "q1", marked_studied: false, worked: false },
      { id: "q2", marked_studied: false, worked: false }
    ]
  });

  state.button(0).handlers.click();
  await flush();
  assert.deepEqual(state.studied, ["q1"]);
  assert.equal(state.button(0).textContent, "PERGUNTA ESTUDADA");
  assert.equal(state.button(0).disabled, true);
  assert.equal(state.button(1).textContent, "ESTUDEI A PERGUNTA");
  assert.match(state.node("conversationStatus").textContent, /Pergunta marcada como estudada/);
});

test("failed save restores the button without indicating successful registration", async () => {
  const state = await startPage({
    questions: [{ id: "q1" }],
    progress: [{ id: "q1", marked_studied: false, worked: false }],
    writeError: new Error("Synthetic write failure")
  });

  state.button(0).handlers.click();
  await flush();
  assert.equal(state.button(0).disabled, false);
  assert.equal(state.button(0).textContent, "ESTUDEI A PERGUNTA");
  assert.deepEqual(state.studied, []);
  assert.match(state.node("conversationStatus").textContent, /Synthetic write failure/);
});

test("unverified progress keeps the catalog readable but blocks unsafe registrations", async () => {
  const state = await startPage({
    questions: [{ id: "q1" }],
    planError: new Error("Synthetic plan failure")
  });
  assert.equal(state.cards().length, 1);
  assert.equal(state.button(0).textContent, "ESTUDO INDISPONÍVEL");
  assert.equal(state.button(0).disabled, true);
  assert.match(state.node("conversationStatus").textContent, /Não foi possível verificar/);
});

test("teacher catalog does not receive student study buttons", async () => {
  const state = await startPage({ questions: [{ id: "q1" }], teacher: true });
  assert.equal(state.cards().length, 1);
  assert.equal(state.cards()[0].children.length, 1);
});
