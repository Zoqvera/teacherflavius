const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const migration = read("supabase/migrations/20261015065000_homeworks_stage5_teacher_review.sql");

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.textContent = "";
    this.value = "";
    this.disabled = false;
  }
  append(...items) { this.children.push(...items); }
  appendChild(item) { this.children.push(item); return item; }
  replaceChildren(...items) { this.children = items; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(event, listener) { this.listeners[event] = listener; }
  dispatch(event) { return this.listeners[event]?.({ preventDefault() {} }); }
  get childElementCount() { return this.children.length; }
}

function descendants(rootNode, tag) {
  const result = [];
  for (const child of rootNode.children) {
    if (child.tag === tag) result.push(child);
    result.push(...descendants(child, tag));
  }
  return result;
}

function load(filename, globalName, document) {
  const context = { window: {}, document };
  vm.runInNewContext(read(filename), context);
  return context.window[globalName];
}

test("teacher review RPC requires both server-side admin privileges and MFA", () => {
  assert.match(migration, /create function public\.homework_review_queue/);
  assert.match(migration, /create function public\.homework_review_answer/);
  assert.equal((migration.match(/not \(select public\.is_teacher_admin\(\)\)/g) || []).length, 2);
  assert.equal((migration.match(/auth\.jwt\(\)->>'aal'/g) || []).length, 2);
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /security definer set search_path = ''/);
  assert.match(migration, /grant execute on function public\.homework_review_queue\(integer\) to authenticated/);
  assert.match(migration, /grant execute on function public\.homework_review_answer\(uuid,numeric,text\) to authenticated/);
  assert.doesNotMatch(migration, /grant execute[^\n]*to anon/);
  assert.doesNotMatch(migration, /update public\.homework_release_control|update public\.exercise_assignments/);
});

test("manual grade is serialized, version-scoped, and only final when all scores exist", () => {
  assert.match(migration, /where id=candidate_answer_id for update/);
  assert.match(migration, /where id=p_answer_id and attempt_id=target\.id for update/);
  assert.match(migration, /question_row\.question_type <> 'short_answer'/);
  assert.match(migration, /and q\.version_id=t\.version_id/);
  assert.match(migration, /if question_total <> answer_total or question_total = 0 then/);
  assert.match(migration, /if pending = 0 then/);
  assert.match(migration, /round\(sum\(a\.score\*q\.points\)\/nullif\(sum\(q\.points\),0\),2\)/);
  assert.match(migration, /set score=grade,status='evaluated',evaluated_at=now\(\)/);
  assert.match(migration, /'pending_review',pending/);
  assert.match(migration, /source,score,general_comment/);
});

test("teacher RPC service validates scores, justification, and handles database errors", async () => {
  const calls = [];
  const service = load("homework_teacher_review_service.js", "HomeworkTeacherReviewService");
  const auth = { getClient: () => ({ rpc: async (name, payload) => {
    calls.push([name, payload]);
    return { data: name === "homework_review_queue" ? [] :
      { status: "submitted", pending_review: 1 }, error: null };
  } }) };
  assert.deepEqual(await service.queue(auth), []);
  const result = await service.review(auth, "answer-id", 7.5, "Conteúdo adequado ao enunciado.");
  assert.equal(result.pending_review, 1);
  assert.deepEqual(calls.map(call => call[0]), ["homework_review_queue", "homework_review_answer"]);
  assert.equal(calls[1][1].p_score, 7.5);
  assert.equal(calls[1][1].p_answer_id, "answer-id");
  await assert.rejects(service.review(auth, "answer-id", 11, "Nota acima do máximo"), /nota de 0 a 10/);
  await assert.rejects(service.review(auth, "answer-id", 5, "curto"), /justificativa/);
  await assert.rejects(service.review(null, "answer-id", 5, "Resposta pedagógica adequada."), /Autenticação/);
  const badAuth = { getClient: () => ({ rpc: async () => ({
    data: null, error: { message: "MFA requerido" }
  }) }) };
  await assert.rejects(service.queue(badAuth), /MFA requerido/);
});

test("review UI escapes student input and prevents duplicate grading while saving", async () => {
  const document = {
    createElement: tag => new FakeNode(tag),
    createDocumentFragment: () => new FakeNode("fragment")
  };
  const renderer = load("homework_teacher_review_renderer.js",
    "HomeworkTeacherReviewRenderer", document);
  const mount = new FakeNode("section");
  const submissions = [];
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  renderer.render({
    mount,
    records: [{
      answer_id: "answer-id",
      activity_type: "reading",
      exercise_number: 1,
      question_prompt: "<script>não executar</script>",
      response_text: "<img src=x onerror=alert(1)>",
      question_points: 2,
      accepted_answers: ["yes", "indeed"]
    }],
    onReview: async (...args) => { submissions.push(args); return pending; }
  });
  const inputs = descendants(mount, "input");
  const textarea = descendants(mount, "textarea")[0];
  const form = descendants(mount, "form")[0];
  const button = descendants(mount, "button")[0];
  assert.equal(descendants(mount, "script").length, 0);
  assert.equal(descendants(mount, "img").length, 0);
  assert.equal(descendants(mount, "p").some(node =>
    node.textContent.includes("<img")), true);
  inputs[0].value = "8.25";
  textarea.value = "Resposta parcialmente correta e clara.";
  const first = form.dispatch("submit");
  await form.dispatch("submit");
  assert.equal(submissions.length, 1);
  assert.equal(button.disabled, true);
  complete({ status: "evaluated" });
  await first;
  assert.equal(button.disabled, false);
  assert.equal(submissions[0][1], 8.25);
  assert.match(descendants(mount, "p").at(-1).textContent, /Nota final/);
  assert.doesNotMatch(read("homework_teacher_review_renderer.js"),
    /innerHTML|document\.write|fetch\(/);
});

test("private review UI retains noindex and cannot be mounted before teacher authorization", () => {
  const html = read("area-do-estudante/homeworks/index.html");
  const app = read("area-do-estudante/homeworks/foundation.js");
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(html, /id="homeworkReview"[^>]*[\s\S]*?hidden>/);
  assert.match(html, /homework_teacher_review_service\.js/);
  assert.match(app, /access !== window\.HomeworkAccessService\.ACCESS\.TEACHER/);
  assert.match(app, /window\.HomeworkTeacherReviewService\.queue\(window\.Auth\)/);
  assert.doesNotMatch(html, /homework_student_service\.js|href="\/atividade_[0-9]+/);
});
