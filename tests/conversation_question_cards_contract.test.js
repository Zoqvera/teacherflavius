const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const renderer = read("conversation_question_card_renderer.js");
const service = read("conversation_questions_service.js");
const conversationPage = read("conversation-questions/index.html");
const actionPage = read("o-que-fazer/index.html");
const workflowService = read("academic_workflow_service.js");
const baseline = read("supabase/baseline/160_add_conversation_question_cards.sql");
const enforcement = read("supabase/migrations/20261004085216_enforce_conversation_question_card_content.sql");

test("conversation questions persist translation and exactly five modeled answers", function () {
  assert.match(service, /question_translation/);
  assert.match(service, /answer_examples/);
  assert.match(service, /examples\.length !== 5/);
  assert.match(enforcement, /total_questions <> 104/);
  assert.match(enforcement, /jsonb_array_length\(answer_examples\) = 5/);
  assert.match(baseline, /display_order = 104/);
  assert.match(baseline, /conversation_questions_answer_examples_check/);
});

test("one shared renderer presents the same card structure in both student surfaces", function () {
  assert.match(renderer, /Exemplos de respostas:/);
  assert.match(renderer, /conversation-card-question-translation/);
  assert.match(renderer, /conversation-card-example-translation/);
  assert.match(renderer, /conversation-card-example-note/);
  assert.match(conversationPage, /conversation_question_card_renderer\.js/);
  assert.match(actionPage, /conversation_question_card_renderer\.js/);
  assert.match(workflowService, /hydrateQuestions/);
  assert.match(workflowService, /question_translation,answer_examples/);
});

test("new card surfaces keep prohibited public-site wording out", function () {
  for (const content of [renderer, service, conversationPage, actionPage, workflowService]) {
    assert.doesNotMatch(content, /\bonline\b/i);
  }
});
