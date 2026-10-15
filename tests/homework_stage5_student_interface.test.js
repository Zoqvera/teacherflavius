const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..",
  "homework_student_interface.js"), "utf8");

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.value = "";
    this.textContent = "";
    this.disabled = false;
  }

  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  addEventListener(type, handler) { this.listeners[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  dispatch(type) { return this.listeners[type]?.({ preventDefault() {} }); }
  get childElementCount() { return this.children.length; }
}

function descendants(root, tag) {
  const matches = [];
  for (const child of root.children) {
    if (!tag || child.tag === tag) matches.push(child);
    matches.push(...descendants(child, tag));
  }
  return matches;
}

function displayText(root) {
  return [root.textContent, ...root.children.map(displayText)].join(" ");
}

function harness(type = "writing") {
  const document = {
    createElement: name => new FakeNode(name),
    createDocumentFragment: () => new FakeNode("fragment"),
  };
  const window = {};
  vm.runInNewContext(source, { window, document });
  const assignment = "00000000-0000-4000-8000-000000000001";
  const mount = new FakeNode("main");
  const notice = new FakeNode("status");
  const calls = { submissions: [], made: 0, renderedFeedback: 0, details: 0, retries: 0 };
  let nextSubmitError = false;
  let nextProgressError = false;
  let budgetPaused = false;
  let progress = { status: "not_started", score: null, feedback: [] };
  const content = type === "writing" ? { prompt: "Describe your day.", guidelines: ["Use English."] }
    : type === "reading" ? { passage: "I read in the morning.", instructions: ["Answer."] }
      : { explanation: "Present tense.", examples: ["I study English."] };
  const detail = {
    assignment_id: assignment, title: "Homework", exercise_number: 1,
    activity_type: type, content,
    questions: type === "writing" ? [] : [
      { id: "q1", prompt: "Which word?", question_type: "multiple_choice",
        options: ["yes", "no"], points: 1 },
      { id: "q2", prompt: "Your answer?", question_type: "short_answer",
        options: [], points: 1 },
    ],
  };
  const service = {
    list: async () => ({ assignments: [{
      assignment_id: assignment, title: "Homework", exercise_number: 1,
      activity_type: type, score: progress.score, status: progress.status,
    }] }),
    detail: async (_auth, id) => { assert.equal(id, assignment); calls.details++; return detail; },
    progress: async (_auth, id) => {
      assert.equal(id, assignment);
      if (nextProgressError) {
        nextProgressError = false;
        throw new Error("Progress temporarily unavailable");
      }
      return progress;
    },
    retryCorrection: async (_auth, id) => {
      assert.equal(id, assignment);
      calls.retries++;
      progress = { status: "evaluated", score: 9, feedback: [{
        source: "ai", score: 9,
        original_text: "I study English in the morning.",
        corrected_text: "I studied English in the morning.",
        general_comment: "Adequate text and communication.",
        explanations: ["Use the simple past for yesterday."]
      }] };
      return progress;
    },
    makeSubmission: (id, answers) => {
      assert.equal(id, assignment);
      calls.made++;
      return Object.freeze({ assignment_id: id, submission_key: "fixed-uuid", answers });
    },
    submit: async (_auth, value) => {
      calls.submissions.push(value);
      if (nextSubmitError) {
        nextSubmitError = false;
        throw new Error("Network offline");
      }
      if (budgetPaused) {
        progress = { status: "submitted", score: null, feedback: [] };
        return { ...progress, correction: "monthly_budget" };
      }
      progress = { status: "evaluated", score: 8, feedback: type === "writing" ?
        [{ source: "ai", score: 8, original_text: value.answers.text,
          corrected_text: "I studied English.", general_comment: "Good work.",
          explanations: ["Use the past tense."] }] : [] };
      return progress;
    },
  };
  const feedbackRenderer = { appendWritingFeedback(container, feedback) {
    calls.renderedFeedback++;
    container.appendChild(new FakeNode("corrected-text"));
    assert.equal(feedback.source, "ai");
  } };
  const controller = window.HomeworkStudentInterface.create({
    mount, notice, auth: {}, service, feedbackRenderer,
  });
  return {
    mount, notice, controller, calls, get progress() { return progress; },
    setSubmitError: () => { nextSubmitError = true; },
    setBudgetPaused: () => { budgetPaused = true; },
    setProgressError: () => { nextProgressError = true; },
    setProgress: value => { progress = value; },
    buildAnswers: window.HomeworkStudentInterface.buildAnswers,
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("student UI is inert until explicitly mounted and loaded", async () => {
  const h = harness();
  assert.equal(h.calls.details, 0);
  assert.equal(h.mount.children.length, 0);
  await h.controller.load();
  assert.match(displayText(h.mount), /Minhas tarefas para casa/);
  assert.match(displayText(h.mount), /Não realizada/);
  assert.equal(h.calls.made, 0);
});

test("Writing submit displays official feedback immediately, without another-study prompts", async () => {
  const h = harness();
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(h.notice.textContent, /^Não foi possível/, h.notice.textContent);
  assert.match(displayText(h.mount),
    /seu texto será enviado ao serviço de IA da OpenAI/);
  assert.match(displayText(h.mount), /Não inclua nomes completos/);
  const textarea = descendants(h.mount, "textarea")[0];
  assert.ok(textarea);
  textarea.value = "I study English every morning and I like it.";
  textarea.dispatch("input");
  assert.match(displayText(h.mount), /Caracteres: 44/);
  const form = descendants(h.mount, "form")[0];
  form.dispatch("submit");
  await flush();
  assert.equal(h.calls.made, 1);
  assert.equal(h.calls.submissions.length, 1);
  assert.equal(h.progress.status, "evaluated");
  assert.equal(h.calls.renderedFeedback, 1);
  assert.match(displayText(h.mount), /Nota: 8\/10/);
  assert.doesNotMatch(displayText(h.mount), /estudar agora/i);
});

test("network retry reuses the same immutable submission key and answers", async () => {
  const h = harness();
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(h.notice.textContent, /^Não foi possível/, h.notice.textContent);
  const text = descendants(h.mount, "textarea")[0];
  text.value = "I study English every morning and I like it.";
  h.setSubmitError();
  const form = descendants(h.mount, "form")[0];
  form.dispatch("submit");
  await flush();
  assert.equal(h.calls.submissions.length, 1);
  assert.match(h.notice.textContent, /Network offline/);
  text.value = "I changed the text after the network error.";
  form.dispatch("submit");
  await flush();
  assert.equal(h.calls.made, 1);
  assert.strictEqual(h.calls.submissions[0], h.calls.submissions[1]);
  assert.equal(h.progress.status, "evaluated");
});

test("Reading and Grammar inputs validate and submit server-side IDs without answer keys", async () => {
  for (const type of ["reading", "grammar"]) {
    const h = harness(type);
    await h.controller.open("00000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(h.notice.textContent, /^Não foi possível/, h.notice.textContent);
    assert.doesNotMatch(displayText(h.mount), /enviado ao serviço de IA da OpenAI/);
    const select = descendants(h.mount, "select")[0];
    const input = descendants(h.mount, "input")[0];
    assert.ok(select && input);
    select.value = "yes";
    input.value = "a short answer";
    descendants(h.mount, "form")[0].dispatch("submit");
    await flush();
    assert.equal(h.calls.made, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.calls.submissions[0].answers)), [
      { question_id: "q1", response: "yes" }, { question_id: "q2", response: "a short answer" }
    ]);
    assert.match(displayText(h.mount), /Nota: 8\/10/);
    assert.doesNotMatch(JSON.stringify(h.calls.submissions), /answer_key/);
  }
});

test("pending Writing progress never manufactures a final grade or submits twice", async () => {
  const h = harness();
  h.setProgress({ status: "submitted", score: null, feedback: [] });
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  assert.doesNotMatch(h.notice.textContent, /^Não foi possível/, h.notice.textContent);
  assert.match(displayText(h.mount), /correção está pendente/);
  assert.doesNotMatch(displayText(h.mount), /Nota:/);
  assert.equal(descendants(h.mount, "form").length, 0);
  assert.equal(h.calls.made, 0);
});

test("submission validation refuses missing answers or too-short Writing", () => {
  const h = harness();
  assert.throws(() => h.buildAnswers("writing", [], { value: "too short" }),
    /20 e 3.000/);
  assert.throws(() => h.buildAnswers("reading",
    [{ id: "q1", read: () => " " }], null), /todas as perguntas/);
});

test("Writing saved before page reload can be corrected by the persisted server attempt", async () => {
  const h = harness();
  h.setProgress({ status: "submitted", score: null, feedback: [] });
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  assert.match(displayText(h.mount), /Tentar corrigir novamente/);
  assert.equal(descendants(h.mount, "form").length, 0);
  const retry = descendants(h.mount, "button")
    .find(button => button.textContent === "Tentar corrigir novamente");
  assert.ok(retry);
  retry.dispatch("click");
  await flush();
  assert.equal(h.calls.retries, 1);
  assert.equal(h.calls.made, 0, "no duplicate student submission is constructed");
  assert.equal(h.calls.renderedFeedback, 1);
  assert.match(displayText(h.mount), /Nota: 9\/10/);
});

test("successful submission shows official feedback even if the next progress fetch fails", async () => {
  const h = harness();
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  const text = descendants(h.mount, "textarea")[0];
  text.value = "I study English every morning and I like it.";
  h.setProgressError();
  descendants(h.mount, "form")[0].dispatch("submit");
  await flush();
  assert.equal(h.calls.submissions.length, 1);
  assert.equal(h.calls.renderedFeedback, 1);
  assert.match(displayText(h.mount), /Nota: 8\/10/);
  assert.doesNotMatch(h.notice.textContent, /Envio não confirmado/);
});

test("Reading/Grammar pending states never instruct manual teacher review", async () => {
  const h = harness("reading");
  h.setProgress({ status: "submitted", score: null, feedback: [] });
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  assert.match(displayText(h.mount), /nota automática está sendo confirmada/);
  assert.doesNotMatch(displayText(h.mount), /revisão do professor/i);
});

test("Writing monthly budget pause preserves the sent text and shows a clear status", async () => {
  const h = harness();
  await h.controller.open("00000000-0000-4000-8000-000000000001");
  h.setBudgetPaused();
  const writing = descendants(h.mount, "textarea")[0];
  writing.value = "Yesterday I went to school and studied English.";
  descendants(h.mount, "form")[0].dispatch("submit");
  await flush();
  assert.equal(h.calls.made, 1);
  assert.equal(h.calls.submissions.length, 1);
  assert.equal(h.progress.status, "submitted");
  assert.match(displayText(h.mount), /limite mensal de correções por IA foi atingido/);
  assert.match(displayText(h.mount), /A correção poderá ser retomada no mês seguinte/);
  assert.doesNotMatch(displayText(h.mount), /Nota:/);
});
