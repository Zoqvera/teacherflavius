const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const sql = read("supabase/migrations/20261015071000_homeworks_auto_grade_reading_grammar.sql");
const historical = read("supabase/migrations/20261015060000_homeworks_stage4_submission.sql");
const priorReview = read("supabase/migrations/20261015065000_homeworks_stage5_teacher_review.sql");
const editor = read("area-do-estudante/homeworks/foundation.js");
const html = read("area-do-estudante/homeworks/index.html");

test("Reading and Grammar grade every submitted answer automatically", () => {
  assert.match(sql, /create or replace function public\.homework_submit\(/);
  assert.match(sql, /accepted_answers := case/);
  assert.match(sql, /for accepted in select value from jsonb_array_elements_text\(accepted_answers\)/);
  assert.match(sql, /lower\(regexp_replace\(response_text/);
  assert.match(sql, /lower\(regexp_replace\(trim\(accepted\)/);
  assert.match(sql, /if answer_correct then points_earned := points_earned \+ question_points/);
  assert.match(sql, /case when answer_correct then 10 else 0 end/);
  assert.match(sql, /final_score := round\(10 \* points_earned \/ points_total,2\)/);
  assert.match(sql, /result_status := 'evaluated'/);
  assert.match(sql, /evaluated_at=now\(\)/);
  assert.match(sql, /\(attempt_id,source,score,general_comment\)/);
  assert.doesNotMatch(sql, /if pending_review = 0 then/);
  assert.doesNotMatch(sql, /pending_review := pending_review \+ 1/);
});

test("missing or malformed answer keys never create an invented score", () => {
  assert.match(sql, /jsonb_array_length\(accepted_answers\) = 0/);
  assert.match(sql, /jsonb_typeof\(candidate\.value\) <> 'string'/);
  assert.match(sql, /raise exception 'Gabarito ausente ou inválido/);
  assert.match(sql, /questions_total = 0 or jsonb_array_length\(p_payload\) <> questions_total/);
  assert.match(sql, /question_row\.id = any\(questions_seen\)/);
  assert.match(sql, /assigned\.student_id <> p_student_id/);
  assert.match(sql, /target\.published_version_id is distinct from assigned\.version_id/);
  assert.match(sql, /prior\.submission_key <> p_submission_key/);
});

test("manual grading RPCs are removed while past migrations stay immutable", () => {
  assert.match(sql, /drop function if exists public\.homework_review_answer/);
  assert.match(sql, /drop function if exists public\.homework_review_queue/);
  assert.match(priorReview, /create function public\.homework_review_queue/);
  assert.match(historical, /create function public\.homework_claim_writing/);
  assert.match(sql, /revoke all on function public\.homework_submit.*from public,anon,authenticated/);
  assert.match(sql, /grant execute on function public\.homework_submit.*to service_role/);
});

test("editor handles multiple accepted variants without manual review UI", () => {
  assert.match(editor, /parts\[1\]\.split\(";"\)\.map/);
  assert.match(editor, /accepted\.join\("; "\)/);
  assert.doesNotMatch(html, /homework_teacher_review|id="homeworkReview"/);
  assert.doesNotMatch(editor, /HomeworkTeacherReview/);
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.doesNotMatch(html, /homework_student_interface|href="\/atividade_/);
});

test("Writing remains an independent GPT-6 Luna server-side correction", () => {
  assert.match(sql, /if activity = 'writing' then/);
  assert.match(sql, /Writing requer texto de 20 a 3000 caracteres/);
  assert.match(historical, /create function public\.homework_complete_writing/);
  const edge = read("supabase/functions/homework-student/index.ts");
  assert.match(edge, /const MODEL = "gpt-6-luna"/);
  assert.match(edge, /if \(submitted\.activity_type !== "writing"/);
});