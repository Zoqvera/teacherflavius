"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const editorSource = fs.readFileSync(path.join(ROOT, "lesson_presentation_editor.js"), "utf8");
const pageSource = fs.readFileSync(path.join(ROOT, "licao/index.html"), "utf8");
const lessonSource = fs.readFileSync(path.join(ROOT, "licao.js"), "utf8");
const cssSource = fs.readFileSync(path.join(ROOT, "lesson_presentation_editor.css"), "utf8");
const AUTHOR = "11111111-1111-4111-8111-111111111111";
const PAGE = "44444444-4444-4444-8444-444444444444";

function editor() {
  const context = {
    window: {},
    console: { error() { throw new Error("A disabled editor attempted a request."); } }
  };
  vm.runInNewContext(editorSource, context);
  return context.window.LessonPresentationEditor;
}

function element(initialValue = "") {
  const listeners = {};
  return {
    value: initialValue,
    textContent: "",
    disabled: false,
    hidden: true,
    dataset: {},
    addEventListener(name, callback) { listeners[name] = callback; },
    fire(name) {
      const event = { preventDefault() { event.prevented = true; }, prevented: false };
      listeners[name](event);
      return event;
    }
  };
}

function controls() {
  return {
    section: element(),
    form: element(),
    input: element(),
    button: element(),
    status: element(),
    counter: element()
  };
}

function database() {
  const calls = [];
  const responses = { load: { data: null, error: null }, save: { data: null, error: null } };

  function builder() {
    const entry = { type: "load", filters: [], selected: null, payload: null };
    calls.push(entry);
    return {
      select(fields) { entry.selected = fields; return this; },
      eq(field, value) { entry.filters.push([field, value]); return this; },
      insert(data) { entry.type = "insert"; entry.payload = data; return this; },
      update(data) { entry.type = "update"; entry.payload = data; return this; },
      async single() { return responses.save; },
      async maybeSingle() { return entry.type === "load" ? responses.load : responses.save; }
    };
  }

  return {
    calls,
    responses,
    client: {
      from(name) {
        assert.equal(name, "lesson_presentations");
        return builder();
      }
    }
  };
}

test("release remains hard-disabled without a URL, storage or runtime override", async () => {
  const instance = editor();
  assert.equal(instance.enabled, false);
  assert.equal(await instance.mount({
    getClient() { throw new Error("Supabase must not be queried"); }
  }), false);
  assert.match(editorSource, /const RELEASE_ENABLED = false;/);
  assert.doesNotMatch(editorSource, /localStorage|sessionStorage|URLSearchParams|location\.search/);
  assert.match(lessonSource, /editor\.enabled !== true/);
  assert.match(pageSource, /id="lessonPresentationSection"[^>]*hidden>/);
});

test("navigation resolves one identity for linked and direct numbered lessons", () => {
  const instance = editor();
  assert.equal(instance.lessonIdentity(12, PAGE).key, "lesson:12");
  assert.equal(instance.lessonIdentity("12", null).key, "lesson:12");
  assert.equal(instance.lessonIdentity(null, PAGE).key, "page:" + PAGE);
  assert.throws(() => instance.lessonIdentity(0, PAGE), /inválido/);
  assert.throws(() => instance.lessonIdentity(null, "not-uuid"), /inválido/);
  assert.match(lessonSource, /setupLessonPresentation\(studentId, lessonNumber, null\)/);
  assert.match(lessonSource, /setupLessonPresentation\(studentId, lessonNumber, lessonNumber \? null : page\.id\)/);
  assert.match(lessonSource, /loadByLessonNumber\(lessonService, lessonNumber, session\.user\.id\)/);
  assert.match(lessonSource, /loadByPageId\(lessonService, pageId, session\.user\.id\)/);
});

test("validates trimmed nonempty text and the 15000 character limit", () => {
  const instance = editor();
  assert.equal(instance.normalizedBody("  My presentation  "), "My presentation");
  assert.throws(() => instance.normalizedBody("   "), /Escreva/);
  assert.equal(instance.normalizedBody("X".repeat(15000)).length, 15000);
  assert.throws(() => instance.normalizedBody("X".repeat(15001)), /15.000/);
});

test("inserts only ownership, lesson identity and text, then edits only body", async () => {
  const api = editor();
  const dom = controls();
  const db = database();
  const ctl = api.create({ elements: dom, getClient: () => db.client });

  assert.equal(await ctl.load({ studentId: AUTHOR, lessonNumber: 4 }), true);
  assert.equal(db.calls[0].filters[0][0], "student_id");
  assert.equal(db.calls[0].filters[0][1], AUTHOR);
  assert.equal(db.calls[0].filters[1][0], "lesson_key");
  assert.equal(db.calls[0].filters[1][1], "lesson:4");
  assert.equal(dom.section.hidden, false);
  assert.equal(dom.button.textContent, "ENVIAR APRESENTAÇÃO");

  dom.input.value = "  My first presentation.  ";
  dom.input.fire("input");
  assert.equal(dom.button.disabled, false);
  db.responses.save = {
    data: { id: PAGE, body: "My first presentation.", revision_number: 1, updated_at: "2026-10-17T12:00:00Z" },
    error: null
  };
  assert.equal(await ctl.save(), true);
  assert.equal(db.calls[1].type, "insert");
  assert.equal(db.calls[1].payload.student_id, AUTHOR);
  assert.equal(db.calls[1].payload.lesson_number, 4);
  assert.equal(db.calls[1].payload.body, "My first presentation.");
  assert.deepEqual(Object.keys(db.calls[1].payload).sort(), ["body", "lesson_number", "student_id"]);
  assert.equal(dom.button.textContent, "EDITAR APRESENTAÇÃO");
  assert.equal(dom.status.textContent, "Apresentação enviada ao professor.");
  assert.equal(dom.button.disabled, true);

  dom.input.value = "My revised presentation.";
  dom.input.fire("input");
  db.responses.save = {
    data: { id: PAGE, body: "My revised presentation.", revision_number: 2, updated_at: "2026-10-17T13:00:00Z" },
    error: null
  };
  assert.equal(await ctl.save(), true);
  assert.equal(db.calls[2].type, "update");
  assert.deepEqual(db.calls[2].payload, { body: "My revised presentation." });
  assert.ok(db.calls[2].filters.some(([key, value]) => key === "revision_number" && value === 1));
  assert.ok(db.calls[2].filters.some(([key, value]) => key === "student_id" && value === AUTHOR));
  assert.equal(dom.status.dataset.tone, "success");
});

test("existing presentation is loaded for the correct dynamic page and preserves its revision", async () => {
  const db = database();
  const dom = controls();
  db.responses.load.data = {
    id: PAGE, body: "Existing", revision_number: 3, updated_at: "2026-10-17T13:00:00Z"
  };
  const ctl = editor().create({ elements: dom, getClient: () => db.client });
  assert.equal(await ctl.load({ studentId: AUTHOR, pageId: PAGE }), true);
  assert.equal(db.calls[0].filters[1][1], "page:" + PAGE);
  assert.equal(dom.input.value, "Existing");
  assert.equal(dom.button.textContent, "EDITAR APRESENTAÇÃO");
  assert.match(dom.status.textContent, /Apresentação já enviada/);
});

test("save failure and optimistic concurrency preserve the student's unsaved draft", async () => {
  const db = database();
  const dom = controls();
  db.responses.load.data = {
    id: PAGE, body: "Existing", revision_number: 3, updated_at: "2026-10-17T13:00:00Z"
  };
  const ctl = editor().create({ elements: dom, getClient: () => db.client });
  await ctl.load({ studentId: AUTHOR, lessonNumber: 12 });
  dom.input.value = "Unsaved revised text";
  db.responses.save = { data: null, error: null };
  assert.equal(await ctl.save(), false);
  assert.equal(dom.input.value, "Unsaved revised text");
  assert.match(dom.status.textContent, /mudou em outra sessão/);
  assert.equal(dom.status.dataset.tone, "error");
  assert.equal(dom.button.disabled, false);

  db.responses.save = { data: null, error: { message: "A rede está indisponível" } };
  assert.equal(await ctl.save(), false);
  assert.equal(dom.input.value, "Unsaved revised text");
  assert.equal(dom.status.textContent, "A rede está indisponível");
});

test("interface is accessible, responsive, printable and preserves the existing SEO directives", () => {
  for (const id of [
    "lessonPresentationSection",
    "lessonPresentationForm",
    "lessonPresentationBody",
    "lessonPresentationSubmit",
    "lessonPresentationStatus",
    "lessonPresentationCount"
  ]) assert.ok(pageSource.includes('id="' + id + '"'));
  assert.match(pageSource, /maxlength="15000"/);
  assert.match(pageSource, /aria-live="polite"/);
  assert.match(pageSource, /for="lessonPresentationBody"/);
  assert.match(pageSource, /lesson_presentation_editor\.js\?v=/);
  assert.match(pageSource, /lesson_presentation_editor\.css\?v=/);
  assert.match(cssSource, /#lessonPresentationSection\[hidden\]/);
  assert.match(cssSource, /@media print[\s\S]*#lessonPresentationSection/);
  assert.match(cssSource, /@media \(max-width: 639px\)/);
  assert.match(pageSource, /<meta name="robots" content="noindex,nofollow">/);
  assert.doesNotMatch(pageSource, /<meta name="description"/);
});
