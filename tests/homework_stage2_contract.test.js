const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");
const sql = read("supabase/migrations/20261015044000_homeworks_stage2_schema.sql");

function loadAdminService() {
  const context = { window: {} };
  vm.runInNewContext(read("homework_admin_service.js"), context);
  return context.window.HomeworkAdminService;
}

function fakeAuth(overrides = {}) {
  const calls = [];
  const makeQuery = table => ({
    select(fields) { calls.push(["select", table, fields]); return this; },
    eq(field, value) { calls.push(["eq", field, value]); return this; },
    order(field) { calls.push(["order", field]); return this; },
    limit(count) { calls.push(["limit", count]); return this; },
    then(resolve) { return Promise.resolve({ data: overrides.data || [], error: null }).then(resolve); }
  });
  return {
    calls,
    getClient: () => ({
      from: table => makeQuery(table),
      rpc: (name, payload) => {
        calls.push(["rpc", name, payload]);
        return Promise.resolve(overrides.error
          ? { error: { message: overrides.error } } : { data: overrides.rpcData || null });
      }
    })
  };
}

test("schema has seven new homework tables and none reuse the legacy teacher_exercises", () => {
  const names = ["exercises", "exercise_versions", "exercise_questions",
    "exercise_assignments", "exercise_attempts", "exercise_answers", "exercise_feedback"];
  for (const name of names) {
    assert.match(sql, new RegExp("create table public\\." + name + " \\("));
  }
  assert.doesNotMatch(sql, /alter table public\.teacher_exercises/);
});

test("schema enforces teacher-only RLS and holds every assignment", () => {
  assert.match(sql, /enable row level security/);
  assert.match(sql, /auth\.jwt\(\)->>'aal'/);
  assert.match(sql, /for all to authenticated using \(\(select public\.is_teacher_admin\(\)\) and/);
  assert.match(sql, /revoke all on table public\.%I from anon, authenticated/);
  assert.match(sql, /status text not null default 'held' check \(status = 'held'\)/);
  assert.doesNotMatch(sql, /to anon[\s\S]*?grant select/);
});

test("reading, writing, grammar cycle and approval are enforced on server", () => {
  assert.match(sql, /case exercise_number % 3 when 1 then 'reading' when 2 then 'writing' else 'grammar'/);
  assert.match(sql, /target\.activity_type = 'reading' and question_total <> 10/);
  assert.match(sql, /target\.activity_type = 'writing' and question_total <> 0/);
  assert.match(sql, /target\.activity_type = 'grammar' and question_total < 1/);
  assert.match(sql, /selected\.status <> 'approved'/);
  assert.match(sql, /status = 'published'/);
});

test("administration uses the private Data API and named RPCs", async () => {
  const service = loadAdminService();
  const auth = fakeAuth({ rpcData: "version-id" });
  await service.listExercises(auth);
  await service.listVersions(auth, "exercise-id");
  await service.listQuestions(auth, "version-id");
  await service.createDraft(auth);
  await service.saveVersion(auth, {
    exerciseId: "exercise-id", title: "Reading 1", content: { passage: "Text" },
    questions: []
  });
  await service.approveVersion(auth, "version-id");
  await service.publishVersion(auth, "version-id");
  const operations = auth.calls.filter(call => call[0] === "rpc").map(call => call[1]);
  assert.deepEqual(operations, ["homework_create_draft", "homework_save_version",
    "homework_approve_version", "homework_publish"]);
  assert.deepEqual(auth.calls.filter(call => call[0] === "select").map(call => call[1]),
    ["exercises", "exercise_versions", "exercise_questions"]);
});

test("backend failures and invalid drafts are not accepted as success", async () => {
  const service = loadAdminService();
  await assert.rejects(() => service.createDraft(fakeAuth({ error: "Negado" })), /Negado/);
  await assert.rejects(() => service.saveVersion(fakeAuth(), {
    exerciseId: "id", title: "", content: {}, questions: []
  }), /Rascunho incompleto/);
  await assert.rejects(() => service.listExercises(null), /Autenticação indisponível/);
});

test("manager remains hidden before authorization, noindex, and has no student routes", () => {
  const html = read("area-do-estudante/homeworks/index.html");
  const script = read("area-do-estudante/homeworks/foundation.js");
  assert.match(html, /meta name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(html, /id="homeworkPreview"[^>]*hidden/);
  assert.match(html, /id="homeworkEditor"[^>]*hidden/);
  assert.match(html, /homework_admin_service\.js/);
  assert.match(script, /access !== window\.HomeworkAccessService\.ACCESS\.TEACHER/);
  assert.doesNotMatch(html, /href="\/atividade_[0-9]+\//);
  assert.doesNotMatch(html, /<script[^>]+openai/i);
});
