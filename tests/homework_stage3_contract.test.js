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

test("reading and grammar preview preserves accents and punctuation like the official key", () => {
  const preview = loadPreview();
  const questions = [
    { answer_key: { accepted: ["São Paulo", "SP"] }, points: 1 },
    { answer_key: { accepted: ["has gone"] }, points: 1 },
    { answer_key: { correct: "was" }, points: 1 }
  ];
  const result = preview.evaluateResponses(questions,
    ["sao paulo!", "HAS   GONE", "was"]);
  assert.equal(result.correct, 2);
  assert.equal(result.total, 3);
  assert.equal(result.score, 6.67);
  assert.equal(result.ready, true);
  assert.equal(result.results[0].correct, false);
  assert.equal(preview.normalizeAnswer("  Às  CIDADES? "), "às cidades?");
  assert.equal(preview.normalizeAnswer(" A    B "), "a b");
});

test("weighted local preview matches the official grading scale", () => {
  const preview = loadPreview();
  const questions = [
    { answer_key: { correct: "hello" }, points: 3 },
    { answer_key: { accepted: ["world", "earth"] }, points: 1 },
    { answer_key: { correct: "yes" }, points: 6 }
  ];
  const result = preview.evaluateResponses(questions, ["HELLO", "wrong", "YES"]);
  assert.equal(result.correct, 2);
  assert.equal(result.total, 3);
  assert.equal(result.score, 9);
  assert.equal(result.ready, true);
});

test("incomplete answers, invalid key, or invalid choice cannot create a preview grade", () => {
  const preview = loadPreview();
  const validKey = { answer_key: { correct: "yes" }, points: 2 };
  for (const questions of [
    [validKey, { answer_key: null, points: 1 }],
    [validKey, { answer_key: { accepted: ["yes", ""] }, points: 1 }],
    [validKey, { answer_key: { correct: 42 }, points: 1 }],
    [validKey, { answer_key: { correct: "no" }, points: -1 }],
  ]) {
    const result = preview.evaluateResponses(questions, ["yes", "no"]);
    assert.equal(result.score, null);
    assert.equal(result.ready, false);
  }
  const blank = preview.evaluateResponses([validKey], [" "]);
  assert.equal(blank.score, null);
  assert.equal(blank.ready, false);
  const choice = preview.evaluateResponses([{
    question_type: "multiple_choice", options: ["yes", "no"],
    answer_key: { correct: "yes" }, points: 1
  }], ["maybe"]);
  assert.equal(choice.score, null);
  assert.equal(choice.ready, false);
});

test("simulation rejects mismatched responses rather than inventing a score", () => {
  const preview = loadPreview();
  assert.throws(() => preview.evaluateResponses([{}], []), /incompatíveis/);
  const response = preview.evaluateResponses([{ answer_key: null }], ["abc"]);
  assert.equal(response.score, null);
  assert.equal(response.total, 0);
});

test("teacher approval refuses a question with invalid grading weight", () => {
  const preview = loadPreview();
  const exercise = { activity_type: "grammar", exercise_number: 3 };
  const version = { content: { explanation: "Present tense." } };
  const invalid = [{
    prompt: "Complete the sentence", question_type: "short_answer",
    answer_key: { correct: "is" }, points: -2
  }];
  const report = preview.inspectForApproval(exercise, version, invalid);
  assert.equal(report.ready, false);
  assert.ok(report.issues.some(issue => issue.includes("peso de pontuação inválido")));
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
