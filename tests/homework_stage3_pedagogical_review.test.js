const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.textContent = "";
    this.value = "";
    this.checked = false;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.children = nodes;
  }

  setAttribute(key, value) {
    this.attributes[key] = value;
  }

  addEventListener(name, handler) {
    this.listeners[name] = handler;
  }

  dispatch(name) {
    this.listeners[name]?.({ preventDefault() {} });
  }

  get childElementCount() {
    return this.children.length;
  }
}

function descendants(node, tag) {
  const result = [];
  for (const child of node.children) {
    if (child.tag === tag) result.push(child);
    result.push(...descendants(child, tag));
  }
  return result;
}

function loadPreview() {
  const document = {
    createElement: tag => new FakeNode(tag),
    createDocumentFragment: () => new FakeNode("fragment")
  };
  const context = { window: {}, document };
  vm.runInNewContext(read("homework_pedagogical_preview.js"), context);
  return context.window.HomeworkPedagogicalPreview;
}

const question = (type, answer) => ({
  question_type: type,
  prompt: "Qual é a resposta?",
  options: type === "multiple_choice" ? ["yes", "no"] : [],
  answer_key: answer == null ? null : { accepted: [answer] },
  explanation: "Revise a explicação."
});

test("Reading review refuses fewer than 10 questions and missing answer keys", () => {
  const preview = loadPreview();
  const exercise = { activity_type: "reading" };
  const version = { content: { passage: "A morning in London." } };
  const fewer = preview.inspectForApproval(exercise, version, [question("short_answer", "yes")]);
  assert.equal(fewer.ready, false);
  assert.match(fewer.issues.join(" "), /exatamente 10/);
  const noKey = Array.from({ length: 10 }, () => question("short_answer", null));
  const invalid = preview.inspectForApproval(exercise, version, noKey);
  assert.equal(invalid.ready, false);
  assert.match(invalid.issues.join(" "), /não contém gabarito/);
  const ready = preview.inspectForApproval(exercise, version,
    Array.from({ length: 10 }, () => question("short_answer", "yes")));
  assert.equal(ready.ready, true);
});

test("Grammar review enforces answer membership in multiple-choice options", () => {
  const preview = loadPreview();
  const exercise = { activity_type: "grammar" };
  const version = { content: { explanation: "Simple present." } };
  assert.equal(preview.inspectForApproval(exercise, version, []).ready, false);
  assert.equal(preview.inspectForApproval(exercise, version,
    [question("multiple_choice", "maybe")]).ready, false);
  assert.equal(preview.inspectForApproval(exercise, version,
    [question("multiple_choice", "yes")]).ready, true);
});

test("Writing review needs a prompt and no objective questions", () => {
  const preview = loadPreview();
  const exercise = { activity_type: "writing" };
  assert.equal(preview.inspectForApproval(exercise, { content: { prompt: "" } }, []).ready,
    false);
  assert.equal(preview.inspectForApproval(exercise, { content: { prompt: "Write a letter." } },
    [question("short_answer", "yes")]).ready, false);
  assert.equal(preview.inspectForApproval(exercise, { content: { prompt: "Write a letter." } },
    []).ready, true);
});

test("word count and corrected-text highlighting preserve spelling and whitespace", () => {
  const preview = loadPreview();
  assert.equal(preview.countWords("I  am\nstudying English."), 4);
  assert.equal(preview.countWords("  "), 0);
  const changed = preview.diffCorrectedText("I go to school.", "I went to school.");
  assert.equal(changed.map(part => part.text).join(""), "I went to school.");
  assert.deepEqual(Array.from(changed.filter(part => part.changed), x => x.text), ["went"]);
  const addition = preview.diffCorrectedText("I go school.", "I go to school.");
  assert.deepEqual(Array.from(addition.filter(part => part.changed), x => x.text), ["to"]);
});

test("private Reading preview shows progress, simulates exact matches and can reset", () => {
  const preview = loadPreview();
  const mount = new FakeNode("div");
  preview.render({
    mount,
    exercise: { activity_type: "reading", exercise_number: 1, title: "Reading 1" },
    version: { content: { passage: "We read English." } },
    questions: [question("short_answer", "yes"), question("multiple_choice", "yes")]
  });
  const form = descendants(mount, "form")[0];
  const input = descendants(form, "input").find(item => item.type === "text");
  input.value = "yes";
  form.dispatch("input");
  assert.match(descendants(form, "p").map(item => item.textContent).join(" "),
    /Questões respondidas: 1 de 2/);
  form.dispatch("submit");
  assert.match(descendants(form, "p").map(item => item.textContent).join(" "),
    /Não é possível calcular nota/);
  assert.equal(descendants(form, "details").length, 2);

  // Um envio incompleto não pode exibir uma nota que o PostgreSQL recusaria.
  const options = descendants(form, "select");
  if (options.length) {
    options[0].value = "yes";
  } else {
    const radios = descendants(form, "input").filter(item => item.type === "radio");
    assert.ok(radios.length);
    radios[0].checked = true;
  }
  form.dispatch("submit");
  assert.match(descendants(form, "p").map(item => item.textContent).join(" "),
    /Não é nota oficial/);
  form.dispatch("reset");
  assert.match(descendants(form, "p").map(item => item.textContent).join(" "),
    /Questões respondidas: 0 de 2/);
});

test("Writing preview counts words without uploading or fabricating AI feedback", () => {
  const preview = loadPreview();
  const mount = new FakeNode("div");
  preview.render({
    mount,
    exercise: { activity_type: "writing", exercise_number: 2, title: "Writing 2" },
    version: { content: { prompt: "Write about your family.", model: "I have a sister." } },
    questions: []
  });
  const text = descendants(mount, "textarea")[0];
  const form = descendants(mount, "form")[0];
  text.value = "This is my family.";
  text.dispatch("input");
  assert.match(descendants(form, "p").map(item => item.textContent).join(" "), /Palavras: 4/);
  form.dispatch("submit");
  assert.match(descendants(form, "p").map(item => item.textContent).join(" "),
    /texto não enviado/);
  assert.equal(descendants(mount, "h3").some(n => n.textContent === "Modelo de referência"),
    true);
});

test("safe Writing feedback highlights only corrected text, without HTML injection", () => {
  const preview = loadPreview();
  const mount = new FakeNode("div");
  preview.appendWritingFeedback(mount, {
    source: "ai",
    score: 8.5,
    general_comment: "Bom trabalho.",
    original_text: "I go to school.",
    corrected_text: "I went to school.",
    explanations: ["Use o passado de go."]
  });
  assert.deepEqual(descendants(mount, "mark").map(node => node.textContent), ["went"]);
  assert.equal(descendants(mount, "h4").length, 3);
  assert.throws(() => preview.appendWritingFeedback(mount, {
    source: "ai",
    score: 99,
    original_text: "",
    corrected_text: "",
    general_comment: "",
    explanations: []
  }), /inválido/);
});

test("the historical version interface stays hidden before teacher verification", () => {
  const html = read("area-do-estudante/homeworks/index.html");
  const script = read("area-do-estudante/homeworks/foundation.js");
  assert.match(html, /id="homeworkVersionHistory"[^>]*hidden/);
  assert.match(script, /window\.HomeworkPedagogicalPreview\.inspectForApproval/);
  assert.match(script, /renderVersionHistory\(exercise, versions\)/);
  assert.match(script, /access !== window\.HomeworkAccessService\.ACCESS\.TEACHER/);
  assert.doesNotMatch(script, /\.from\("exercise_answers"\)/);
});
