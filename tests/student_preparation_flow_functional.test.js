"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const STUDENT_CONTROLLER = read("o-que-fazer/app.js");
const LESSON_CONTROLLER = read("licao.js");

function element(tagName = "div") {
  return {
    tagName,
    children: [],
    className: "",
    hidden: false,
    disabled: false,
    textContent: "",
    dataset: {},
    style: {},
    attributes: {},
    handlers: {},
    set innerHTML(value) {
      this.children = [];
      this.html = value;
    },
    get innerHTML() { return this.html || ""; },
    appendChild(child) { this.children.push(child); },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(event, callback) { this.handlers[event] = callback; }
  };
}

function makeDocument(initiallyHidden = []) {
  const nodes = new Map();
  return {
    nodes,
    body: { classList: { remove() {} } },
    getElementById(id) {
      if (!nodes.has(id)) {
        const node = element();
        node.hidden = initiallyHidden.includes(id);
        nodes.set(id, node);
      }
      return nodes.get(id);
    },
    createElement: element,
    querySelectorAll: () => [],
    get title() { return this.pageTitle || ""; },
    set title(value) { this.pageTitle = value; }
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function runStudentScenario({
  pathname = "/o-que-fazer/",
  enabled = false,
  plan = { lesson: null, questions: [] },
  reviews = [],
  session = true,
  planError = null,
  reviewError = null
} = {}) {
  const document = makeDocument([
    "studentPreparationWelcome",
    "startConversationFallback"
  ]);
  const calls = { plans: 0, reviews: 0, studied: [], replaced: [] };
  const service = {
    async getMyActionPlan() {
      calls.plans += 1;
      if (planError) throw planError;
      return plan;
    },
    async getMyReviewQuestions() {
      calls.reviews += 1;
      if (reviewError) throw reviewError;
      return reviews;
    },
    async markQuestionStudied(id) {
      calls.studied.push(id);
      const found = plan.questions.find((item) => item.id === id);
      if (found) found.marked_studied = true;
    }
  };
  const location = {
    pathname,
    href: "",
    replace(target) { calls.replaced.push(target); }
  };
  const window = {
    location,
    StudentPreparationFlow: { enabled },
    SUPABASE_CONFIG: {},
    Auth: {
      isConfigured: () => true,
      getSession: async () => session ? { user: { id: "synthetic" } } : null,
      getClient: () => ({})
    },
    ResourceWaiter: { waitUntil: async () => true },
    AcademicWorkflowService: {
      create: () => service,
      lessonUrl: (number) => number ? "/licao/?lesson=" + number : ""
    },
    ConversationQuestionCardRenderer: {
      create(question, options) {
        return { question, number: options.number };
      }
    }
  };

  vm.runInNewContext(STUDENT_CONTROLLER, {
    window, document, console: { error() {} }
  }, { filename: "o-que-fazer/app.js" });
  await flush();

  return { window, document, calls, service, node: (id) => document.getElementById(id) };
}

function question(id, marked = false, worked = false) {
  return { id, text: "Question " + id, marked_studied: marked, worked, studied: false };
}

test("disabled rollout preserves the original O QUE FAZER experience", async () => {
  const state = await runStudentScenario({
    plan: { lesson: { number: 3, has_material: true, prepared: false }, questions: [question("q1")] },
    reviews: [question("review")]
  });
  assert.equal(state.node("studentPreparationWelcome").hidden, true);
  assert.equal(state.node("legacyActionPlan").hidden, false);
  assert.equal(state.node("legacyActionPlanDescription").hidden, false);
  assert.equal(state.node("nextLessonContainer").children.length, 1);
  assert.equal(state.node("actionQuestionList").children.length, 1);
  assert.equal(state.node("reviewQuestionList").children.length, 1);
  assert.equal(state.calls.reviews, 1);
});

test("disabled second part redirects before loading private records", async () => {
  const state = await runStudentScenario({
    pathname: "/o-que-fazer/segunda-parte/",
    enabled: false
  });
  assert.deepEqual(state.calls.replaced, ["/o-que-fazer/"]);
  assert.equal(state.calls.plans, 0);
  assert.equal(state.calls.reviews, 0);
});

test("enabled welcome shows only the introduction and COMEÇAR opens the student's next lesson", async () => {
  const state = await runStudentScenario({
    enabled: true,
    plan: { lesson: { number: 12, has_material: true }, questions: [question("q1")] }
  });
  assert.equal(state.node("studentPreparationWelcome").hidden, false);
  assert.equal(state.node("legacyActionPlan").hidden, true);
  assert.equal(state.node("legacyActionPlanDescription").hidden, true);
  assert.equal(state.node("startPreparationButton").disabled, false);
  assert.equal(state.node("startConversationFallback").hidden, true);
  assert.equal(state.calls.reviews, 0);
  state.node("startPreparationButton").onclick();
  assert.equal(state.window.location.href, "/licao/?lesson=12");
});

test("unpublished or exhausted next lesson allows conversation without a dead end", async () => {
  for (const lesson of [{ number: 14, has_material: false }, null]) {
    const state = await runStudentScenario({ enabled: true, plan: { lesson, questions: [] } });
    assert.equal(state.node("startPreparationButton").disabled, true);
    assert.equal(state.node("startConversationFallback").hidden, false);
    assert.match(state.node("welcomePreparationStatus").textContent, /conversação/i);
  }
});

test("second part reuses review cards, filters studied questions and updates counts after a click", async () => {
  const state = await runStudentScenario({
    pathname: "/o-que-fazer/segunda-parte/",
    enabled: true,
    plan: {
      lesson: { number: 5, has_material: true },
      questions: [question("pending"), question("already", true), question("worked", false, true)]
    },
    reviews: [question("due-1"), question("due-2")]
  });
  assert.equal(state.node("reviewQuestionList").children.length, 2);
  assert.equal(state.node("reviewQuestionsCount").textContent, "2");
  assert.equal(state.node("actionQuestionList").children.length, 2);
  assert.equal(state.node("questionsCount").textContent, "2");
  assert.equal(state.node("returnToLessonLink").href, "/licao/?lesson=5");
  assert.equal(state.node("actionQuestionList").children[1].children[1].children[0].disabled, true);

  state.node("actionQuestionList").children[0].children[1].children[0].handlers.click();
  await flush();
  assert.deepEqual(state.calls.studied, ["pending"]);
  assert.equal(state.node("actionQuestionList").children.length, 1);
  assert.equal(state.node("questionsCount").textContent, "1");
  assert.equal(state.node("reviewQuestionList").children.length, 2);
  assert.equal(state.node("reviewQuestionsCount").textContent, "2");
});

test("second part falls back to the introduction when no next lesson exists", async () => {
  const state = await runStudentScenario({
    pathname: "/o-que-fazer/segunda-parte/",
    enabled: true
  });
  assert.equal(state.node("returnToLessonLink").href, "/o-que-fazer/");
  assert.equal(state.node("reviewQuestionsCount").textContent, "0");
  assert.equal(state.node("questionsCount").textContent, "0");
});

test("direct navigation to the private second page requires authentication", async () => {
  const state = await runStudentScenario({
    pathname: "/o-que-fazer/segunda-parte/",
    enabled: true,
    session: false
  });
  assert.match(state.window.location.href, /^\/login\/\?next=/);
  assert.equal(
    decodeURIComponent(state.window.location.href.split("next=")[1]),
    "/o-que-fazer/segunda-parte/"
  );
  assert.equal(state.calls.plans, 0);
});

test("a review RPC failure does not hide the remaining conversation questions", async () => {
  const state = await runStudentScenario({
    pathname: "/o-que-fazer/segunda-parte/",
    enabled: true,
    reviews: [],
    reviewError: new Error("Synthetic database failure"),
    plan: { lesson: null, questions: [question("still-visible")] }
  });
  assert.equal(state.node("actionQuestionList").children.length, 1);
  assert.match(state.node("reviewQuestionsStatus").textContent, /Não foi possível carregar/);
});

async function runLessonScenario({
  enabled = false,
  currentLesson = 7,
  requestedLesson = 7,
  alreadyPrepared = false,
  session = true,
  roadmapSource = false,
  requestedById = false,
  nextPublished = true,
  legacyNext = false
} = {}) {
  const document = makeDocument([
    "lessonPageContent",
    "lessonPreparationSection",
    "lessonNextPartLink",
    "lessonNextLessonLink",
    "lessonRoadmapNavigation",
    "lessonFlowProgress",
    "legacyLessonMaterial"
  ]);
  const calls = { prepared: [], plans: 0 };
  const pageId = "11111111-1111-4111-8111-111111111111";
  const nextPageId = "22222222-2222-4222-8222-222222222222";
  const linkedPage = {
    roadmap_lesson_number: requestedLesson,
    title: "Testing lesson",
    lesson_number_label: "LESSON 7",
    objective: "Objective",
    example: "Example",
    translation: "Translation",
    practical_exercise: "Exercise",
    useful_vocabulary: "Vocabulary"
  };
  const window = {
    location: {
      pathname: "/licao/",
      search: (requestedById ? "?id=" + pageId : "?lesson=" + requestedLesson) +
        (roadmapSource ? "&source=roteiro-de-estudos" : ""),
      href: ""
    },
    StudentPreparationFlow: { enabled },
    SUPABASE_CONFIG: {},
    Auth: {
      isConfigured: () => true,
      getSession: async () => session ? { user: { id: "synthetic" } } : null,
      getClient: () => ({})
    },
    ResourceWaiter: { waitUntil: async () => true },
    StudyLessonService: {
      isValidPageId: (id) => id === pageId,
      lessonPageUrl: (id) => "/licao/?id=" + id,
      create: () => ({
        getLinkedPageByLessonNumber: async (number) => {
          if (number === requestedLesson) return linkedPage;
          if (number === requestedLesson + 1 && nextPublished) return { id: nextPageId };
          return null;
        },
        getPage: async (id) => id === pageId ? linkedPage : null
      })
    },
    AcademicWorkflowService: {
      normalizeLessonNumber: Number,
      legacyLessonPreviewUrl: (number) => legacyNext && number === requestedLesson + 1
        ? "https://drive.google.com/file/d/synthetic/preview" : "",
      create: () => ({
        getMyActionPlan: async () => {
          calls.plans += 1;
          return { lesson: { number: currentLesson, prepared: alreadyPrepared } };
        },
        markLessonPrepared: async (number) => { calls.prepared.push(number); }
      })
    },
    print() {}
  };
  vm.runInNewContext(LESSON_CONTROLLER, {
    window,
    document,
    URLSearchParams,
    console: { error() {} }
  }, { filename: "licao.js" });
  await flush();
  return { node: (id) => document.getElementById(id), window, calls };
}

test("legacy lesson preparation stays intact when rollout is disabled", async () => {
  const state = await runLessonScenario();
  assert.equal(state.node("lessonPreparationSection").hidden, false);
  assert.equal(state.node("lessonNextPartLink").hidden, true);
  assert.equal(state.node("lessonFlowProgress").hidden, true);
  state.node("lessonPreparedButton").onclick();
  await flush();
  assert.deepEqual(state.calls.prepared, [7]);
  assert.equal(state.node("lessonPreparedButton").disabled, true);
});

test("enabled lesson shows PRÓXIMA PARTE but does not implicitly mark preparation", async () => {
  const state = await runLessonScenario({ enabled: true });
  assert.equal(state.node("lessonNextPartLink").hidden, false);
  assert.equal(state.node("lessonNextPartLink").href, undefined);
  assert.equal(state.node("lessonFlowProgress").hidden, false);
  assert.equal(state.node("lessonLegacyPreparationContent").hidden, true);
  assert.equal(state.node("lessonRoadmapNavigation").hidden, true);
  assert.deepEqual(state.calls.prepared, []);
});

test("already prepared lessons continue without exposing the legacy preparation button", async () => {
  const state = await runLessonScenario({ enabled: true, alreadyPrepared: true });
  assert.equal(state.node("lessonNextPartLink").hidden, false);
  assert.equal(state.node("lessonLegacyPreparationContent").hidden, true);
  assert.deepEqual(state.calls.prepared, []);
});

test("older lessons do not expose the new two-part navigation", async () => {
  const state = await runLessonScenario({ enabled: true, currentLesson: 8, requestedLesson: 7 });
  assert.equal(state.node("lessonPreparationSection").hidden, true);
  assert.equal(state.node("lessonNextPartLink").hidden, true);
});

test("roadmap access to the current lesson shows only PRÓXIMA LIÇÃO", async () => {
  const state = await runLessonScenario({ enabled: true, roadmapSource: true });
  assert.equal(state.node("lessonPreparationSection").hidden, true);
  assert.equal(state.node("lessonFlowProgress").hidden, true);
  assert.equal(state.node("lessonNextPartLink").hidden, true);
  assert.equal(state.node("lessonRoadmapNavigation").hidden, false);
  assert.equal(state.node("lessonNextLessonLink").hidden, false);
  assert.equal(
    state.node("lessonNextLessonLink").href,
    "/licao/?id=22222222-2222-4222-8222-222222222222&source=roteiro-de-estudos"
  );
  assert.equal(state.calls.plans, 0);
  assert.deepEqual(state.calls.prepared, []);
});

test("roadmap navigation also works for pages opened by ID", async () => {
  const state = await runLessonScenario({
    enabled: true,
    roadmapSource: true,
    requestedById: true
  });
  assert.equal(state.node("lessonNextLessonLink").hidden, false);
  assert.equal(state.node("lessonPreparationSection").hidden, true);
});

test("legacy PDF next lesson remains accessible within roadmap viewer", async () => {
  const state = await runLessonScenario({
    enabled: true,
    roadmapSource: true,
    nextPublished: false,
    legacyNext: true
  });
  assert.equal(state.node("lessonNextLessonLink").hidden, false);
  assert.equal(
    state.node("lessonNextLessonLink").href,
    "/licao/?lesson=8&source=roteiro-de-estudos"
  );
});

test("unpublished next lesson does not lead to a broken link", async () => {
  const state = await runLessonScenario({
    enabled: true,
    roadmapSource: true,
    requestedLesson: 74,
    currentLesson: 74,
    nextPublished: false
  });
  assert.equal(state.node("lessonRoadmapNavigation").hidden, false);
  assert.equal(state.node("lessonNextLessonLink").hidden, true);
  assert.match(state.node("lessonRoadmapStatus").textContent, /não há uma próxima lição/i);
});

test("roadmap source does not alter the legacy experience with the rollout disabled", async () => {
  const state = await runLessonScenario({
    enabled: false,
    roadmapSource: true
  });
  assert.equal(state.node("lessonPreparationSection").hidden, false);
  assert.equal(state.node("lessonLegacyPreparationContent").hidden, false);
  assert.equal(state.node("lessonNextPartLink").hidden, true);
  assert.equal(state.node("lessonRoadmapNavigation").hidden, true);
  state.node("lessonPreparedButton").onclick();
  await flush();
  assert.deepEqual(state.calls.prepared, [7]);
});
