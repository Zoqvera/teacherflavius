const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004080244_add_academic_lesson_workflow.sql"),
  "utf8"
);
const baseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/150_add_academic_lesson_workflow.sql"),
  "utf8"
);
const ambiguityFix = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261004081746_fix_academic_occurrence_id_ambiguity.sql"),
  "utf8"
);
const allConversationQuestions = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261007000727_show_all_conversation_questions.sql"),
  "utf8"
);
const allConversationQuestionsBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/295_show_all_conversation_questions.sql"),
  "utf8"
);
const lessonSessionFinalization = fs.readFileSync(
  path.join(ROOT, "supabase/migrations/20261007013738_persist_teacher_lesson_session_finalization.sql"),
  "utf8"
);
const lessonSessionFinalizationBaseline = fs.readFileSync(
  path.join(ROOT, "supabase/baseline/305_persist_teacher_lesson_session_finalization.sql"),
  "utf8"
);
const studentArea = fs.readFileSync(path.join(ROOT, "area_do_estudante.html"), "utf8");
const teacherArea = fs.readFileSync(path.join(ROOT, "professor.html"), "utf8");
const studentPage = fs.readFileSync(path.join(ROOT, "o-que-fazer/index.html"), "utf8");
const teacherPage = fs.readFileSync(path.join(ROOT, "roteiro-da-aula/index.html"), "utf8");
const lessonPage = fs.readFileSync(path.join(ROOT, "licao/index.html"), "utf8");
const workflowService = fs.readFileSync(path.join(ROOT, "academic_workflow_service.js"), "utf8");
const studentApp = fs.readFileSync(path.join(ROOT, "o-que-fazer/app.js"), "utf8");
const teacherApp = fs.readFileSync(path.join(ROOT, "roteiro-da-aula/app.js"), "utf8");

const SQL_FILES = [migration, baseline];

test("academic operational records remain private and are exposed through scoped RPCs", function () {
  for (const sql of SQL_FILES) {
    assert.match(sql, /create table if not exists private\.academic_lesson_occurrences/i);
    assert.match(sql, /create table if not exists private\.student_lesson_preparations/i);
    assert.match(sql, /create table if not exists private\.student_question_studies/i);
    assert.match(sql, /create table if not exists private\.conversation_question_practice_log/i);
    assert.match(sql, /revoke all on table[\s\S]*from public, anon, authenticated/i);
    assert.match(sql, /create or replace function public\.get_my_action_plan/i);
    assert.match(sql, /create or replace function public\.get_teacher_lesson_plan/i);
    assert.match(sql, /create or replace function public\.mark_teacher_lesson_presented/i);
    assert.match(sql, /create or replace function public\.rate_teacher_conversation_question/i);
  }
});

test("student preparation is distinct from teacher-confirmed completion", function () {
  for (const sql of SQL_FILES) {
    assert.match(sql, /create or replace function public\.mark_my_lesson_prepared/i);
    assert.match(sql, /insert into private\.student_lesson_preparations/i);
    assert.match(sql, /create or replace function public\.mark_teacher_lesson_presented/i);
    assert.match(sql, /insert into public\.class_lesson_records/i);
    assert.match(sql, /insert into public\.study_roadmap_completion/i);
  }

  assert.match(lessonPage, /id="lessonPreparedButton"/);
  assert.match(lessonPage, />ESTOU PREPARADO</);
});

test("student sees the complete Conversation Questions catalog and studies each question individually", function () {
  for (const sql of [allConversationQuestions, allConversationQuestionsBaseline]) {
    assert.match(sql, /from public\.conversation_questions question/i);
    assert.match(sql, /'studied', question\.studied/i);
    assert.match(sql, /'worked', question\.worked/i);
    assert.match(sql, /conversation_question_practice_log practice/i);
    assert.match(sql, /conversation_question_completions completion/i);
    assert.match(sql, /selected\.question_id = any\(expected_ids\)/i);
    assert.match(sql, /insert into private\.student_question_studies/i);
    assert.doesNotMatch(sql, /limit 10/i);
  }

  assert.match(studentPage, /todas as Conversation Questions disponíveis para estudo/i);
  assert.match(studentApp, /markQuestionStudied\(question\.id\)/);
  assert.match(studentApp, /question\.worked/);
  assert.match(studentApp, /ESTUDEI A PERGUNTA/);
  assert.match(studentApp, /PERGUNTA ESTUDADA/);
  assert.match(studentApp, /PERGUNTA JÁ TRABALHADA/);
  assert.doesNotMatch(studentPage, /id="questionsStudiedButton"/);
  assert.doesNotMatch(studentPage, /ESTUDEI AS PERGUNTAS/);
});

test("spaced review intervals use actually attended lesson sequences", function () {
  for (const sql of SQL_FILES) {
    assert.match(sql, /attendance_sequence integer/i);
    assert.match(sql, /when 'good' then 5/i);
    assert.match(sql, /when 'medium' then 3/i);
    assert.match(sql, /else 1/i);
    assert.match(sql, /due_sequence := occurrence\.attendance_sequence \+ review_interval/i);
    assert.match(sql, /attendance_status = 'present'/i);
  }
});

test("teacher plan excludes cancelled regular lessons and includes only confirmed replacements", function () {
  for (const sql of SQL_FILES) {
    assert.match(sql, /private\.student_regular_lesson_cancellations/i);
    assert.match(sql, /booking\.status = 'confirmed'/i);
    assert.match(sql, /slot\.is_active = true/i);
  }
});

test("absence preserves academic work for a later class", function () {
  for (const sql of SQL_FILES) {
    assert.match(sql, /attendance_status = 'absent'/i);
    assert.match(sql, /'Não compareceu'/i);
    assert.match(
      sql,
      /Esta aula já possui conteúdo registrado\. Desfaça esses registros antes de marcar ausência\./i
    );
  }
});

test("finalized class sessions disappear until the next occurrence", function () {
  for (const sql of [lessonSessionFinalization, lessonSessionFinalizationBaseline]) {
    assert.match(sql, /create table if not exists private\.academic_class_session_finalizations/i);
    assert.match(sql, /unique \(class_number, starts_at\)/i);
    assert.match(sql, /create or replace function public\.finalize_teacher_lesson_session/i);
    assert.match(sql, /attendance_status not in \('present', 'absent'\)/i);
    assert.match(sql, /from private\.academic_class_session_finalizations finalization/i);
    assert.match(sql, /finalization\.class_number = enriched\.class_number/i);
    assert.match(sql, /finalization\.starts_at = enriched\.starts_at/i);
    assert.match(sql, /revoke all on table private\.academic_class_session_finalizations[\s\S]*from public, anon, authenticated/i);
  }

  assert.match(workflowService, /finalize_teacher_lesson_session/);
  assert.match(workflowService, /finalizeTeacherLessonSession/);
  assert.match(teacherApp, /service\.finalizeTeacherLessonSession/);
  assert.match(teacherApp, /Aula finalizada\. A turma foi removida do roteiro desta ocorrência\./);
});

test("student area replaces legacy study cards with O QUE FAZER", function () {
  assert.match(studentArea, /href="\/o-que-fazer\/"/);
  assert.match(studentArea, />O QUE FAZER</);
  assert.doesNotMatch(studentArea, /href="\/roteiro-de-estudos\/"/);
  assert.doesNotMatch(studentArea, /href="\/conversation-questions\/"/);
});

test("teacher area exposes only studied questions with their answer examples", function () {
  assert.match(teacherArea, /href="\/roteiro-da-aula\/"/);
  assert.match(teacherArea, />ROTEIRO DA AULA</);
  assert.match(teacherApp, /APRESENTOU/);
  assert.match(teacherApp, /ALUNO AUSENTE/);
  assert.match(teacherApp, /FINALIZAR AULA/);
  assert.match(teacherApp, /BOM/);
  assert.match(teacherApp, /MÉDIO/);
  assert.match(teacherApp, /MELHORAR/);
  assert.match(teacherApp, /ConversationQuestionCardRenderer\.create/);
  assert.match(teacherPage, /conversation_question_card_renderer\.js/);
  assert.match(workflowService, /hydrateTeacherLessonPlan/);
  assert.match(workflowService, /answer_examples/);

  for (const sql of SQL_FILES) {
    assert.match(
      sql,
      /from private\.student_question_studies study[\s\S]*as new_questions/i
    );
  }
});

test("new academic pages remain private for search engines", function () {
  assert.match(studentPage, /<meta name="robots" content="noindex, nofollow">/i);
  assert.match(teacherPage, /<meta name="robots" content="noindex, nofollow">/i);
});

test("new workflow code contains no prohibited site wording", function () {
  const files = [
    workflowService,
    studentApp,
    teacherApp,
    studentPage,
    teacherPage,
    lessonPage
  ];

  for (const content of files) {
    assert.doesNotMatch(content, /\bonline\b/i);
  }
});

test("attendance synchronization uses an unambiguous occurrence identifier", function () {
  for (const sql of [baseline, ambiguityFix]) {
    assert.match(sql, /saved_occurrence_id uuid/i);
    assert.match(sql, /practice\.occurrence_id = saved_occurrence_id/i);
    assert.doesNotMatch(sql, /practice\.occurrence_id = occurrence_id/i);
  }
});
