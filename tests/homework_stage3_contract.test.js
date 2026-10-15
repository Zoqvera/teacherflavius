const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

function loadPreview() {
  const context = { window: {} };
  vm.runInNewContext(read("homework_pedagogical_preview.js"), context);
  return context.window.HomeworkPedagogicalPreview;
}

test("reading and grammar evaluations normalize answers but never award points for blanks", () => {
  const preview = loadPreview();
  const questions = [
    { answer_key: { accepted: ["São Paulo", "SP"] } },
    { answer_key: { accepted: ["has gone"] } },
    { answer_key: { correct: "was" } },
    { answer_key: null }
  ];
  const result = preview.evaluateResponses(questions, ["sao  paulo!", "HAS GONE", "", "x"]);
  assert.equal(result.correct, 2);
  assert.equal(result.total, 3);
  assert.equal(result.score, 6.7);
  assert.equal(result.results[2].correct, false);
  assert.equal(result.results[3].graded, false);
  assert.equal(preview.normalizeAnswer("  Às  CIDADES? "), "as cidades");
});

test("simulation rejects mismatched responses rather than inventing a score", () => {
  const preview = loadPreview();
  assert.throws(() => preview.evaluateResponses([{}], []), /incompatíveis/);
  const response = preview.evaluateResponses([{ answer_key: null }], ["abc"]);
  assert.equal(response.score, null);
  assert.equal(response.total, 0);
});

test("pedagogical renderer has no network, backend writes or embedded answer fixtures", () => {
  const source = read("homework_pedagogical_preview.js");
  assert.doesNotMatch(source, /fetch\(|\.rpc\(|\.insert\(|\.upsert\(/);
  assert.doesNotMatch(source, /innerHTML|localStorage|sessionStorage|api[_-]?key/i);
  assert.match(source, /event\.preventDefault\(\)/);
  assert.match(source, /correção por IA/);
  assert.match(source, /appendWritingFeedback/);
  assert.match(source, /original_text/);
  assert.match(source, /corrected_text/);
  assert.match(source, /general_comment/);
});

test("teacher-only route contains new interface but never enables student access", () => {
  const html = read("area-do-estudante/homeworks/index.html");
  const manager = read("area-do-estudante/homeworks/foundation.js");
  const schema = read("supabase/migrations/20261015043416_homeworks_stage2_schema.sql");
  assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
  assert.match(html, /id="homeworkPedagogicalPreview"[^>]*[\s\S]*?hidden>/);
  assert.match(html, /homework_pedagogical_preview\.js/);
  assert.match(manager, /access !== window\.HomeworkAccessService\.ACCESS\.TEACHER/);
  assert.match(manager, /window\.HomeworkPedagogicalPreview\.render/);
  assert.match(schema, /status text not null default 'held' check \(status = 'held'\)/);
  assert.doesNotMatch(html, /href="\/atividade_\d+\//);
  assert.doesNotMatch(html, /<script[^>]+openai/i);
});

test("grammar editor supports multiple-choice questions and round trips options", () => {
  const editor = read("area-do-estudante/homeworks/foundation.js");
  assert.match(editor, /type: "multiple_choice"/);
  assert.match(editor, /options\.includes\(parts\[2\]\)/);
  assert.match(editor, /question\.options\.join\("; "\)/);
  assert.match(editor, /Exatamente 10 perguntas em português/);
});
