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
const baseline = read("supabase/baseline/90_add_conversation_questions.sql");
const insertionMigration = read(
  "supabase/migrations/20261002220825_add_surname_and_spelling_conversation_questions.sql"
);
const contactInsertionMigration = read(
  "supabase/migrations/20261002224031_add_phone_and_address_conversation_questions.sql"
);

test("keeps Conversation Questions private from search engines", function () {
  assert.match(page, /<meta name="robots" content="noindex, nofollow">/i);
  assert.equal(sitemap.includes("/conversation-questions/"), false);
});

test("links Conversation Questions only from the professor dashboard", function () {
  assert.match(
    professor,
    /href="\/conversation-questions\/"[^>]*data-card-id="conversation-questions"/
  );
  assert.match(professor, />CONVERSATION QUESTIONS</);
  assert.equal(studentArea.includes('href="/conversation-questions/"'), false);
  assert.equal(studentArea.includes("CONVERSATION QUESTIONS"), false);
  assert.match(professorIcons, /'conversation-questions':\s*'<svg/);
});

test("historical migration seeds the original 99 questions", function () {
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
  assert.match(app, /state\.service\.addQuestion\(questionCard, maxOrder \+ 1\)/);
  assert.match(app, /state\.service\.moveQuestion\(questionId, direction\)/);
  assert.match(migration, /security invoker/i);
  assert.match(migration, /grant execute on function public\.move_conversation_question\(uuid, text\) to authenticated/i);
});

test("inserts surname and spelling prompts after question 07 without replacing existing rows", function () {
  assert.match(insertionMigration, /set display_order = display_order \+ 2/);
  assert.match(insertionMigration, /where display_order >= 8/);
  assert.match(insertionMigration, /\('What''s your surname\?', 8\)/);
  assert.match(insertionMigration, /\('How do you spell your name\?', 9\)/);
  assert.match(insertionMigration, /question_text = 'What is your full name\?'[\s\S]*display_order = 8/);
  assert.doesNotMatch(insertionMigration, /delete from public\.conversation_questions/i);
});

test("inserts phone and address prompts after question 14 without replacing existing rows", function () {
  assert.match(contactInsertionMigration, /set display_order = display_order \+ 2/);
  assert.match(contactInsertionMigration, /where display_order >= 15/);
  assert.match(contactInsertionMigration, /\('What''s you phone number\?', 15\)/);
  assert.match(contactInsertionMigration, /\('What''s your address\?', 16\)/);
  assert.match(contactInsertionMigration, /question_text = 'Do you have any pets\?'[\s\S]*display_order = 14/);
  assert.doesNotMatch(contactInsertionMigration, /delete from public\.conversation_questions/i);
});

test("disaster-recovery baseline contains the canonical 103-question seed", function () {
  const seededQuestions = baseline.match(/\('(?:[^']|'')*',\s*\d+\)/g) || [];
  assert.equal(seededQuestions.length, 103);
  assert.match(baseline, /create table public\.conversation_questions/i);
  assert.match(baseline, /create table public\.conversation_question_completions/i);
  assert.match(baseline, /conversation_question_completions_marked_by_idx/i);
  assert.match(baseline, /\('Are you married or single\?', 7\)/);
  assert.match(baseline, /\('What''s your surname\?', 8\)/);
  assert.match(baseline, /\('How do you spell your name\?', 9\)/);
  assert.match(baseline, /\('What is your full name\?', 10\)/);
  assert.match(baseline, /\('Do you have any pets\?', 14\)/);
  assert.match(baseline, /\('What''s you phone number\?', 15\)/);
  assert.match(baseline, /\('What''s your address\?', 16\)/);
  assert.match(baseline, /\('What languages do you speak\?', 17\)/);
  assert.match(
    baseline,
    /\('What is something most people do not know about you\?', 103\)/
  );
});
