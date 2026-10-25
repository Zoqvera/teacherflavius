"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "teacher_lesson_presentations.js"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "roteiro-da-aula/app.js"), "utf8");
const page = fs.readFileSync(path.join(ROOT, "roteiro-da-aula-legado/index.html"), "utf8");
const styles = fs.readFileSync(path.join(ROOT, "teacher_lesson_presentations.css"), "utf8");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261017144500_lesson_presentation_views_stage3.sql"), "utf8"
);
const STUDENT = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const TEACHER = "33333333-3333-4333-8333-333333333333";
const PRESENTATION = "44444444-4444-4444-8444-444444444444";

function domNode(tag) {
  return {
    tagName: tag,
    children: [],
    attributes: {},
    textContent: "",
    open: false,
    listeners: {},
    appendChild(item) { this.children.push(item); return item; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    async toggle() { return this.listeners.toggle && this.listeners.toggle(); }
  };
}

function loadModule(observers = []) {
  const context = {
    window: {
      IntersectionObserver: class {
        constructor(callback) {
          this.callback = callback;
          observers.push(this);
        }
        observe(target) { this.target = target; }
        disconnect() { this.disconnected = true; }
        notify(isIntersecting) { return this.callback([{ isIntersecting, target: this.target }]); }
      }
    },
    document: { createElement: domNode },
    console: { error() {} }
  };
  vm.runInNewContext(source, context);
  return context.window.TeacherLessonPresentations;
}

function createDb(presentations, receipts) {
  const ops = [];
  const inserted = [];
  function builder(table) {
    const entry = { table, filters: [], select: "", insert: null };
    ops.push(entry);
    return {
      select(cols) { entry.select = cols; return this; },
      in(field, values) { entry.filters.push([field, Array.from(values)]); return this; },
      insert(value) {
        entry.insert = value;
        inserted.push(value);
        return Promise.resolve({ error: null, data: null });
      },
      then(resolve, reject) {
        const data = table === "lesson_presentations" ? presentations : receipts;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      }
    };
  }
  return {
    ops,
    inserted,
    client: { from: builder }
  };
}

function row(studentId = STUDENT, lessonNumber = 12) {
  return { student_id: studentId, lesson_number: lessonNumber, student_name: "Pessoa" };
}

function presentation(studentId = STUDENT, lessonKey = "lesson:12", revisionNumber = 1) {
  return {
    id: PRESENTATION, student_id: studentId, lesson_key: lessonKey,
    body: "My <script>alert(1)</script> presentation",
    revision_number: revisionNumber, updated_at: "2026-10-17T12:00:00Z"
  };
}

test("teacher viewer is source-enabled and loads records only with a provided client", async () => {
  const module = loadModule();
  assert.equal(module.enabled, true);
  const db = createDb([presentation()], []);
  const result = await module.loadPlan([row()], () => db.client, TEACHER);
  assert.equal(result.records.size, 1);
  assert.equal(result.records.get(STUDENT + "|lesson:12").body, presentation().body);
  assert.match(source, /const RELEASE_ENABLED = true;/);
  assert.doesNotMatch(source, /localStorage|sessionStorage|URLSearchParams|location\.search/);
});

test("teacher roster matches both student identity and canonical lesson key", async () => {
  const db = createDb([
    presentation(),
    presentation(OTHER, "lesson:12"),
    presentation(STUDENT, "lesson:13")
  ], []);
  const service = loadModule().create({
    getClient: () => db.client,
    getTeacherId: () => TEACHER
  });
  const results = await service.load([row(), row(OTHER, 14)]);
  assert.equal(results.size, 1);
  assert.ok(results.has(STUDENT + "|lesson:12"));
  assert.equal(db.ops[0].table, "lesson_presentations");
  assert.deepEqual(db.ops[0].filters[0][0], "student_id");
  assert.equal(db.ops[1].table, "lesson_presentation_views");
  assert.match(db.ops[0].select, /student_id,lesson_key/);
  assert.equal(loadModule().rosterKey(STUDENT, 0), null);
  assert.equal(loadModule().rosterKey("not-valid", 12), null);
});

test("only current-version receipts mark a presentation as seen", async () => {
  const db = createDb([presentation()], [
    { presentation_id: PRESENTATION, revision_number: 1, viewed_at: "2026-10-17T12:30:00Z" }
  ]);
  const service = loadModule().create({
    getClient: () => db.client, getTeacherId: () => TEACHER
  });
  const first = await service.load([row()]);
  assert.equal(first.get(STUDENT + "|lesson:12").viewedAt, "2026-10-17T12:30:00Z");

  const edited = createDb([presentation(STUDENT, "lesson:12", 2)], [
    { presentation_id: PRESENTATION, revision_number: 1, viewed_at: "2026-10-17T12:30:00Z" }
  ]);
  const later = await loadModule().create({
    getClient: () => edited.client, getTeacherId: () => TEACHER
  }).load([row()]);
  assert.equal(later.get(STUDENT + "|lesson:12").viewedAt, null);
});

test("mark viewed requires teacher identity, stores only the receipt key and never changes body", async () => {
  const db = createDb([], []);
  const service = loadModule().create({
    getClient: () => db.client, getTeacherId: () => TEACHER
  });
  const record = presentation();
  const marked = await service.markViewed(record);
  assert.ok(marked);
  assert.equal(db.inserted.length, 1);
  assert.deepEqual(Object.keys(db.inserted[0]).sort(), [
    "presentation_id", "revision_number", "teacher_id"
  ]);
  assert.equal(db.inserted[0].teacher_id, TEACHER);
  assert.equal(db.inserted[0].revision_number, 1);
  await service.markViewed(record);
  assert.equal(db.inserted.length, 1);
  assert.match(record.body, /presentation/);
  await assert.rejects(() => service.markViewed({ id: "bad", revision_number: 1 }), /inválida/);
});

test("presentation text stays visible and is marked viewed only on screen", async () => {
  const db = createDb([], []);
  const observers = [];
  const module = loadModule(observers);
  const service = module.create({
    getClient: () => db.client, getTeacherId: () => TEACHER
  });
  const records = new Map([[STUDENT + "|lesson:12", presentation()]]);
  const section = service.render(row(), records);
  assert.equal(section.children[0].textContent, "APRESENTAÇÃO DO ALUNO");
  assert.equal(section.children.some(n => n.tagName === "details"), false);
  const content = section.children.find(n => n.className === "academic-presentation-content");
  assert.ok(content);
  assert.equal(content.children[0].textContent, records.get(STUDENT + "|lesson:12").body);
  assert.equal(db.inserted.length, 0);

  await observers[0].notify(false);
  assert.equal(db.inserted.length, 0, "Offscreen text must not be marked viewed");
  await observers[0].notify(true);
  assert.equal(db.inserted.length, 1);
  assert.equal(observers[0].disconnected, true);
  assert.equal(section.children[1].children[1].textContent, "VISUALIZADA");
  assert.equal(content.children[1].textContent, "Visualização registrada.");

  const refreshed = service.render(row(), records);
  assert.equal(refreshed.children.find(n => n.className === "academic-presentation-content")
    .children[0].textContent, presentation().body);
  assert.equal(db.inserted.length, 1, "Refreshing must not duplicate receipts");
});

test("missing presentation shows truthful absence and no receipt action", () => {
  const db = createDb([], []);
  const service = loadModule().create({
    getClient: () => db.client, getTeacherId: () => TEACHER
  });
  const section = service.render(row(), new Map());
  assert.equal(section.children[1].textContent, "APRESENTAÇÃO NÃO ENVIADA");
  assert.equal(db.inserted.length, 0);
});

test("roster includes the protected section before studied questions", () => {
  assert.match(app, /window\.TeacherLessonPresentations/);
  assert.match(app, /await presentationService\.loadPlan/);
  assert.match(app, /presentationBundle\.service\.render\(item, presentationBundle\.records\)/);
  assert.ok(
    app.indexOf("card.appendChild(presentationBundle.service.render") <
    app.indexOf("card.appendChild(renderPreviouslyStudiedQuestions(")
  );
  assert.match(page, /teacher_lesson_presentations\.js\?v=/);
  assert.match(page, /teacher_lesson_presentations\.css\?v=/);
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(styles, /white-space: pre-wrap/);
  assert.match(styles, /@media \(max-width: 720px\)/);
});

test("view receipt migration denies anonymous access and forbids forged viewed_at", () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /grant insert \(presentation_id, revision_number, teacher_id\)/);
  assert.match(migration, /revision_number = public\.lesson_presentation_views\.revision_number/);
  assert.match(migration, /teacher_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /public\.is_teacher_admin\(\)/);
  assert.match(migration, /has_column_privilege/);
  assert.match(migration, /'viewed_at', 'INSERT'/);
  assert.doesNotMatch(migration, /security definer/i);
});
