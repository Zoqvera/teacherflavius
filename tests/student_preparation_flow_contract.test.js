"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(ROOT, filename), "utf8");
const flag = read("student_preparation_flow.js");
const landing = read("o-que-fazer/index.html");
const landingApp = read("o-que-fazer/app.js");
const lessonPage = read("licao/index.html");
const lessonApp = read("licao.js");
const secondPage = read("o-que-fazer/segunda-parte/index.html");
const styles = read("student_preparation_flow.css");

test("the new preparation journey is disabled by default until separately activated", () => {
  const context = { window: {} };
  vm.runInNewContext(flag, context);
  assert.equal(context.window.StudentPreparationFlow.enabled, false);
  assert.equal(context.window.StudentPreparationFlow.secondPartUrl, "/o-que-fazer/segunda-parte/");
  assert.match(landingApp, /isNewFlowEnabled\(\) && !isSecondPartPage\(\)/);
  assert.match(landingApp, /isSecondPartPage\(\) && !isNewFlowEnabled\(\)/);
  assert.match(landingApp, /location\.replace\("\/o-que-fazer\/"\)/);
  assert.match(styles, /#legacyActionPlan\[hidden\][\s\S]*display: none !important/);
});

test("welcome respects the exact copy and next-lesson resolution", () => {
  assert.match(landing, /Sua aula é composta de duas partes:/);
  assert.match(landing, /<li>Apresentação<\/li>/);
  assert.match(landing, /<li>Conversation<\/li>/);
  assert.match(landing, /Agora é hora de se preparar para a próxima aula\./);
  assert.match(landing, /id="startPreparationButton"[^>]*disabled>COMEÇAR/);
  assert.match(landingApp, /AcademicWorkflowService\.lessonUrl\(lesson\.number\)/);
  assert.match(landingApp, /lesson && lesson\.has_material/);
  assert.match(landingApp, /button\.disabled = !lessonUrl/);
  assert.match(landing, /id="legacyActionPlan"/);
  assert.match(landing, /id="legacyActionPlanDescription"/);
  assert.match(landingApp, /description\.hidden = true/);
});

test("lesson preserves the student's preparation registration and offers a gated continuation", () => {
  assert.match(lessonPage, /id="lessonPreparedButton"[^>]*>ESTOU PREPARADO/);
  assert.match(lessonPage, /id="lessonNextPartLink"[^>]*hidden>PRÓXIMA PARTE/);
  assert.match(lessonApp, /currentLesson !== lessonNumber/);
  assert.match(lessonApp, /window\.StudentPreparationFlow\.enabled === true/);
  assert.match(lessonApp, /markLessonPrepared\(lessonNumber\)/);
  assert.match(lessonPage, /ETAPA 1 DE 2/);
});

test("second part is private, reuses the same student question handlers, and keeps study flags", () => {
  assert.match(secondPage, /name="robots" content="noindex, nofollow"/);
  assert.match(secondPage, /Na segunda parte da aula o professor vai te fazer perguntas e você vai responder de acordo com o que você estudou hoje\./);
  assert.ok(secondPage.indexOf('id="reviewQuestionsTitle"') < secondPage.indexOf('id="questionsTitle"'));
  assert.match(secondPage, /PERGUNTAS AINDA NÃO ESTUDADAS/);
  assert.match(secondPage, /id="actionQuestionList"/);
  assert.match(secondPage, /id="reviewQuestionList"/);
  assert.match(secondPage, /id="returnToLessonLink"/);
  assert.match(landingApp, /backLink\.href = lessonUrl \|\| "\/o-que-fazer\/"/);
  assert.match(secondPage, /src="\/o-que-fazer\/app\.js\?v=/);
  assert.match(landingApp, /service\.markQuestionStudied\(question\.id\)/);
  assert.match(landingApp, /!question\.marked_studied/);
  assert.match(landingApp, /updateQuestionCount\("reviewQuestionsCount", reviews\.length\)/);
  assert.match(landingApp, /updateQuestionCount\("questionsCount", questions\.length\)/);
});
