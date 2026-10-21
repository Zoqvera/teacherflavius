"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const studentSource = fs.readFileSync(path.join(root, "lesson_presentation_editor.js"), "utf8");
const teacherSource = fs.readFileSync(path.join(root, "teacher_lesson_presentations.js"), "utf8");
const studentCss = fs.readFileSync(path.join(root, "lesson_presentation_editor.css"), "utf8");
const teacherCss = fs.readFileSync(path.join(root, "teacher_lesson_presentations.css"), "utf8");
const studentPage = fs.readFileSync(path.join(root, "licao/index.html"), "utf8");
const teacherPage = fs.readFileSync(path.join(root, "roteiro-da-aula/index.html"), "utf8");
const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TEACHER = "33333333-3333-4333-8333-333333333333";
const PAGE = "55555555-5555-4555-8555-555555555555";
const PRESENTATION = "66666666-6666-4666-8666-666666666666";

function node(tagName = "div") {
  return {
    tagName, textContent: "", value: "", className: "", dataset: {},
    disabled: false, hidden: true, open: false, children: [], listeners: {},
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    setAttribute(name, value) { this[name] = value; },
    async fire(type) {
      if (this.listeners[type]) return this.listeners[type]({
        preventDefault() {}
      });
      return undefined;
    }
  };
}

const visibleObservers = [];

function moduleFrom(source, globalName) {
  const context = {
    window: {
      IntersectionObserver: class {
        constructor(callback) {
          this.callback = callback;
          visibleObservers.push(this);
        }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
        notify(isIntersecting) {
          return this.callback([{ isIntersecting, target: this.target }]);
        }
      }
    },
    document: { createElement: node }, console: { error() {} },
    Date, Intl
  };
  vm.runInNewContext(source, context, { timeout: 1000 });
  return context.window[globalName];
}

function dom() {
  return {
    section: node(), form: node(), input: node("textarea"),
    button: node("button"), status: node(), counter: node()
  };
}

// A deterministic Data API double tests JavaScript state/field contracts.
// Database authorization is independently asserted by the PostgreSQL fixture.
function dataApi() {
  const presentations = [];
  const versions = [];
  const receipts = [];
  const requests = [];

  function client(actor) {
    return {
      from(table) {
        const filters = [];
        let type = "select";
        let body = null;
        let projection = null;

        function matches(row) {
          return filters.every(([field, condition, value]) =>
            condition === "eq" ? row[field] === value : value.includes(row[field])
          );
        }

        function rows() {
          if (table === "lesson_presentations") {
            return presentations.filter(row =>
              (actor === TEACHER || row.student_id === actor) && matches(row)
            );
          }
          if (table === "lesson_presentation_views") {
            return receipts.filter(row =>
              (actor === TEACHER || presentations.some(p =>
                p.id === row.presentation_id && p.student_id === actor
              )) && matches(row)
            );
          }
          throw new Error("Unexpected table " + table);
        }

        function perform() {
          requests.push({ table, type, filters: filters.map(f => f[0]) });
          if (type === "select") return { data: rows().map(row => ({ ...row })), error: null };

          if (table === "lesson_presentations" && type === "insert") {
            if (body.student_id !== actor || actor === TEACHER) {
              return { data: null, error: { message: "RLS denied" } };
            }
            const key = body.lesson_number
              ? "lesson:" + body.lesson_number : "page:" + body.lesson_page_id;
            if (presentations.some(row =>
              row.student_id === actor && row.lesson_key === key
            )) return { data: null, error: { message: "duplicate" } };
            const row = {
              id: PRESENTATION, student_id: actor, lesson_key: key,
              lesson_number: body.lesson_number || null, body: body.body,
              revision_number: 1, updated_at: "2026-10-17T11:00:00Z"
            };
            presentations.push(row);
            versions.push({ presentation_id: row.id, revision_number: 1, body: row.body });
            return { data: projection ? { ...row } : null, error: null };
          }

          if (table === "lesson_presentations" && type === "update") {
            const row = rows().find(r => r.student_id === actor);
            if (!row) return { data: null, error: null };
            assert.deepEqual(Object.keys(body), ["body"]);
            row.body = body.body;
            row.revision_number += 1;
            row.updated_at = "2026-10-17T11:05:00Z";
            versions.push({
              presentation_id: row.id,
              revision_number: row.revision_number,
              body: row.body
            });
            return { data: projection ? { ...row } : null, error: null };
          }

          if (table === "lesson_presentation_views" && type === "insert") {
            const row = presentations.find(p => p.id === body.presentation_id);
            if (actor !== TEACHER || body.teacher_id !== TEACHER ||
                !row || row.revision_number !== body.revision_number ||
                Object.keys(body).length !== 3) {
              return { data: null, error: { message: "Receipt RLS denied" } };
            }
            if (receipts.some(r => r.presentation_id === row.id &&
              r.revision_number === row.revision_number && r.teacher_id === TEACHER)) {
              return { data: null, error: { code: "23505" } };
            }
            receipts.push({
              presentation_id: row.id, revision_number: row.revision_number,
              teacher_id: TEACHER, viewed_at: "2026-10-17T11:06:00Z"
            });
            return { data: null, error: null };
          }
          throw new Error("Unsupported write");
        }

        const builder = {
          select(cols) { projection = cols; return builder; },
          eq(field, value) { filters.push([field, "eq", value]); return builder; },
          in(field, values) {
            filters.push([field, "in", Array.from(values)]);
            return builder;
          },
          insert(data) { type = "insert"; body = data; return builder; },
          update(data) { type = "update"; body = data; return builder; },
          async single() { return perform(); },
          async maybeSingle() {
            const result = perform();
            return result.data instanceof Array
              ? { data: result.data[0] || null, error: result.error } : result;
          },
          then(resolve, reject) { return Promise.resolve(perform()).then(resolve, reject); }
        };
        return builder;
      }
    };
  }

  return { client, presentations, versions, receipts, requests };
}

function rosterRow(studentId = STUDENT, lessonNumber = 12) {
  return { student_id: studentId, lesson_number: lessonNumber };
}

function presentationText(section) {
  const content = section.children.find(child =>
    child.className === "academic-presentation-content"
  );
  return content && content.children[0];
}

test("complete browser-module cycle: submit, display, revise and re-read", async () => {
  const database = dataApi();
  const student = moduleFrom(studentSource, "LessonPresentationEditor");
  const teacher = moduleFrom(teacherSource, "TeacherLessonPresentations");
  assert.equal(student.enabled, true);
  assert.equal(teacher.enabled, true);

  const fields = dom();
  const editor = student.create({
    getClient: () => database.client(STUDENT), elements: fields
  });
  await editor.load({ studentId: STUDENT, lessonNumber: 12 });
  assert.equal(fields.button.textContent, "ENVIAR APRESENTAÇÃO");

  fields.input.value = "  My <script>alert(1)</script> presentation.  ";
  await editor.save();
  assert.equal(fields.status.textContent, "Apresentação enviada ao professor.");
  assert.equal(fields.button.textContent, "EDITAR APRESENTAÇÃO");
  assert.equal(database.versions.length, 1);

  const viewer = teacher.create({
    getClient: () => database.client(TEACHER),
    getTeacherId: () => TEACHER
  });
  let records = await viewer.load([rosterRow(), rosterRow(OTHER, 12)]);
  assert.equal(records.size, 1);
  const first = records.get(STUDENT + "|lesson:12");
  assert.equal(first.revision_number, 1);
  assert.equal(first.viewedAt, null);

  const card = viewer.render(rosterRow(), records);
  assert.equal(card.children[0].textContent, "APRESENTAÇÃO DO ALUNO");
  const original = presentationText(card);
  assert.ok(original);
  assert.equal(original.textContent,
    "My <script>alert(1)</script> presentation.");
  assert.equal(database.receipts.length, 0, "Text outside the viewport is not viewed");
  const originalObserver = visibleObservers.shift();
  await originalObserver.notify(false);
  assert.equal(database.receipts.length, 0);
  await originalObserver.notify(true);
  assert.equal(database.receipts.length, 1);
  assert.equal(card.children[1].children[1].textContent, "VISUALIZADA");

  fields.input.value = "My revised presentation.";
  await editor.save();
  assert.equal(database.versions.length, 2);
  assert.equal(database.receipts.length, 1);
  assert.equal(database.versions[0].body, "My <script>alert(1)</script> presentation.");

  records = await viewer.load([rosterRow()]);
  assert.equal(records.get(STUDENT + "|lesson:12").revision_number, 2);
  assert.equal(records.get(STUDENT + "|lesson:12").viewedAt, null);
  const revisedCard = viewer.render(rosterRow(), records);
  assert.equal(revisedCard.children[1].children[1].textContent, "NÃO VISUALIZADA");

  assert.equal(presentationText(revisedCard).textContent, "My revised presentation.");
  await visibleObservers.shift().notify(true);
  assert.equal(database.receipts.length, 2);
  assert.equal(database.receipts[0].revision_number, 1);
  assert.equal(database.receipts[1].revision_number, 2);
  assert.equal(database.presentations[0].student_id, STUDENT);
  assert.equal(database.presentations[0].lesson_key, "lesson:12");
});

test("conflicting sessions preserve the unsaved draft instead of overwriting", async () => {
  const database = dataApi();
  const student = moduleFrom(studentSource, "LessonPresentationEditor");
  const formA = dom();
  const formB = dom();
  const editorA = student.create({
    elements: formA, getClient: () => database.client(STUDENT)
  });
  const editorB = student.create({
    elements: formB, getClient: () => database.client(STUDENT)
  });
  await editorA.load({ studentId: STUDENT, lessonNumber: 12 });
  formA.input.value = "First saved draft";
  await editorA.save();

  await editorB.load({ studentId: STUDENT, lessonNumber: 12 });
  formA.input.value = "Old session draft";
  formB.input.value = "Newer session draft";
  assert.equal(await editorB.save(), true);
  assert.equal(await editorA.save(), false);
  assert.equal(formA.input.value, "Old session draft");
  assert.match(formA.status.textContent, /mudou em outra sessão/);
  assert.equal(database.presentations[0].body, "Newer session draft");
  assert.equal(database.versions.length, 2);
});

test("released pages, mobile styles, accessibility and route identity remain intact", async () => {
  const student = moduleFrom(studentSource, "LessonPresentationEditor");
  const teacher = moduleFrom(teacherSource, "TeacherLessonPresentations");
  assert.equal(await student.mount(null), false);
  const database = dataApi();
  const result = await teacher.loadPlan(
    [rosterRow()], () => database.client(TEACHER), TEACHER
  );
  assert.equal(result.records.size, 0);

  assert.equal(student.lessonIdentity(12, PAGE).key, "lesson:12");
  assert.equal(student.lessonIdentity(null, PAGE).key, "page:" + PAGE);
  assert.equal(teacher.rosterKey(STUDENT, 12), STUDENT + "|lesson:12");

  assert.match(studentPage, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(teacherPage, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(studentPage, /aria-describedby="lessonPresentationCount lessonPresentationStatus"/);
  assert.match(teacherPage, /teacher_lesson_presentations\.css/);
  assert.match(studentCss, /@media \(max-width: 639px\)/);
  assert.match(teacherCss, /@media \(max-width: 720px\)/);
  assert.match(studentCss, /\.lesson-presentation-textarea:focus-visible/);
  assert.match(teacherCss, /\.academic-presentation-content/);
});
