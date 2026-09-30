const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const page = read("conversation-questions/index.html");
const app = read("conversation-questions/app.js");
const service = read("conversation_questions_service.js");
const professor = read("professor.html");
const studentArea = read("area_do_estudante.html");
const professorIcons = read("professor/professor_icons.js");
const sitemap = read("sitemap.xml");
const migration = read(
  "supabase/migrations/20260930154500_add_conversation_questions.sql"
);

test("keeps Conversation Questions private from search engines", function () {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/i);
  assert.equal(sitemap.includes("/conversation-questions/"), false);
});

test("links Conversation Questions from professor and student dashboards", function () {
  assert.match(
    professor,
    /href="\/conversation-questions\/"[^>]*data-card-id="conversation-questions"/
  );
  assert.match(professor, />CONVERSATION QUESTIONS</);
  assert.match(studentArea, /href="\/conversation-questions\/"[\s\S]*?CONVERSATION QUESTIONS/);
  assert.match(professorIcons, /'conversation-questions':\s*'<svg/);
});

test("seeds the normalized list with 99 questions", function () {
  const seededQuestions = migration.match(/\('(?:[^']|'')*',\s*\d+\)/g) || [];
  assert.equal(seededQuestions.length, 99);
  assert.match(migration, /\('How are you\?', 1\)/);
  assert.match(
    migration,
    /\('What is something most people do not know about you\?', 99\)/
  );
});

test("teacher view lists active students and preserves archived progress", function () {
  assert.match(service, /\.eq\("enrolled", true\)/);
  assert.match(service, /\.eq\("archived", false\)/);
  assert.match(migration, /primary key \(question_id, student_id\)/i);
  assert.doesNotMatch(migration, /archived[\s\S]{0,120}delete from public\.conversation_question_completions/i);
});

test("students can read only their own completion rows while teachers can manage all", function () {
  assert.match(
    migration,
    /student_id = \(select auth\.uid\(\)\)/
  );
  assert.match(
    migration,
    /create policy "Teachers can mark conversation questions"[\s\S]*is_teacher_admin\(\)/i
  );
  assert.match(
    migration,
    /create policy "Teachers can unmark conversation questions"[\s\S]*is_teacher_admin\(\)/i
  );
  assert.match(app, /listStudentCompletions\(state\.session\.user\.id\)/);
});

test("teacher can add and reorder questions without exposing student controls", function () {
  assert.match(page, /id="conversationQuestionForm"/);
  assert.match(app, /state\.service\.addQuestion\(text, maxOrder \+ 1\)/);
  assert.match(app, /state\.service\.moveQuestion\(questionId, direction\)/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /grant execute on function public\.move_conversation_question\(uuid, text\) to authenticated/i);
});
