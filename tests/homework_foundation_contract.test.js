const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadGlobal(scriptPath, globalName) {
  const source = fs.readFileSync(path.join(root, scriptPath), "utf8");
  const context = { window: {} };
  vm.runInNewContext(source, context, { filename: scriptPath });
  return context.window[globalName];
}

const model = loadGlobal("homework_activity_model.js", "HomeworkActivityModel");
const access = loadGlobal("homework_access_service.js", "HomeworkAccessService");

test("activity sequence cycles Reading, Writing, Grammar without omissions", function () {
  const drafts = model.listDrafts(10);
  assert.deepEqual(Array.from(drafts, item => item.type), [
    "reading", "writing", "grammar",
    "reading", "writing", "grammar",
    "reading", "writing", "grammar",
    "reading"
  ]);
  assert.equal(model.getActivityType(100), "reading");
});

test("activity blueprints are immutable, numbered and unpublished", function () {
  const drafts = model.listDrafts(3);
  assert.equal(drafts[0].route, "/atividade_1/");
  assert.equal(drafts[1].title, "ATIVIDADE 2 — Writing");
  assert.equal(drafts[2].status, "draft");
  assert.equal(drafts.every(item => item.published === false), true);
  assert.equal(Object.isFrozen(drafts), true);
  assert.equal(Object.isFrozen(drafts[0]), true);
  assert.throws(() => model.createBlueprint(0), /deve ser um inteiro positivo/);
  assert.throws(() => model.listDrafts(61), /Quantidade inválida/);
});

function fakeAuth(result, options = {}) {
  return {
    isConfigured: () => options.configured !== false,
    getSession: async () => options.loggedOut ? null : { user: { id: "test-user" } },
    getClient: () => ({
      rpc: async name => {
        assert.equal(name, "is_teacher_admin");
        if (options.rpcThrows) throw new Error("RPC unavailable");
        return result;
      }
    })
  };
}

test("only a server-confirmed teacher may access the preview", async function () {
  assert.equal(await access.resolveAccess(fakeAuth({ data: true })), access.ACCESS.TEACHER);
  assert.equal(await access.resolveAccess(fakeAuth({ data: false })), access.ACCESS.FORBIDDEN);
  assert.equal(await access.resolveAccess(fakeAuth({ data: "true" })), access.ACCESS.FORBIDDEN);
});

test("the teacher preview fails closed on missing session or RPC errors", async function () {
  assert.equal(await access.resolveAccess(fakeAuth({ data: true }, { loggedOut: true })),
    access.ACCESS.UNAUTHENTICATED);
  assert.equal(await access.resolveAccess(fakeAuth({ data: true }, { configured: false })),
    access.ACCESS.UNAVAILABLE);
  assert.equal(await access.resolveAccess(fakeAuth({ error: { message: "denied" } })),
    access.ACCESS.UNAVAILABLE);
  assert.equal(await access.resolveAccess(fakeAuth({ data: true }, { rpcThrows: true })),
    access.ACCESS.UNAVAILABLE);
  assert.equal(await access.resolveAccess(null), access.ACCESS.UNAVAILABLE);
});

test("no assignments are rendered in static HTML before authorization", function () {
  const html = fs.readFileSync(path.join(root, "area-do-estudante/homeworks/index.html"), "utf8");
  const app = fs.readFileSync(path.join(root, "area-do-estudante/homeworks/foundation.js"), "utf8");
  assert.match(html, /<meta name="robots" content="noindex, nofollow, noarchive">/);
  assert.match(html, /id="homeworkPreview"[^>]*hidden/);
  assert.match(html, /<ol id="homeworkActivityList"[^>]*><\/ol>/);
  assert.match(app, /access !== window\.HomeworkAccessService\.ACCESS\.TEACHER/);
  assert.match(app, /showTeacherPreview\(\);/);
  assert.doesNotMatch(html, /id="homeworkActivityList"[^>]*>\s*<li/);
});
