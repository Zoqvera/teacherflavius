const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
}

const migration = read(
  "supabase/migrations/20261008022624_student_reviews_and_public_testimonials.sql"
);
const baseline = read(
  "supabase/baseline/350_student_reviews_and_public_testimonials.sql"
);
const studentPage = read("avaliar-aulas/index.html");
const studentApp = read("avaliar-aulas/app.js");
const adminPage = read("avaliacoes-dos-alunos/index.html");
const adminApp = read("avaliacoes-dos-alunos/app.js");
const publicScript = read("student_reviews_public.js");
const groupPage = read("aulas-em-grupo/index.html");
const individualPage = read("aulas-individuais/index.html");
const studentArea = read("area_do_estudante.html");
const professor = read("professor.html");
const professorIcons = read("professor/professor_icons.js");
const privacy = read("privacidade/index.html");

function publicReviewFunction(sql) {
  const match = sql.match(
    /create or replace function public\.get_public_student_reviews\(target_lesson_type text\)[\s\S]*?(?=create or replace function public\.get_teacher_student_reviews)/
  );
  assert.ok(match, "public review function should exist");
  return match[0];
}

test("review persistence keeps one active review per student with constrained fields", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /create table if not exists private\.student_class_reviews/i);
    assert.match(sql, /constraint student_class_reviews_student_unique unique \(student_id\)/i);
    assert.match(sql, /check \(rating between 1 and 5\)/i);
    assert.match(sql, /check \(lesson_type in \('group', 'individual'\)\)/i);
    assert.match(sql, /check \(status in \('pending', 'approved', 'rejected'\)\)/i);
    assert.match(sql, /publication_consent_at timestamptz not null/i);
    assert.match(sql, /on conflict \(student_id\) do update/i);
    assert.match(sql, /status = 'pending'/i);
  }
});

test("student review submission derives lesson type from the verified profile", function () {
  for (const sql of [migration, baseline]) {
    assert.match(sql, /when 'INDIVIDUAL' then 'individual'/i);
    assert.match(sql, /when 'QUINTETO' then 'group'/i);
    assert.match(sql, /coalesce\(profile\.enrolled, false\) = true/i);
    assert.match(sql, /coalesce\(profile\.archived, false\) = false/i);
  }

  assert.doesNotMatch(studentPage, /name="lessonType"/i);
  assert.match(studentPage, /id="reviewLessonType"/);
});

test("public review feed exposes only approved consent-backed recent reviews", function () {
  for (const sql of [migration, baseline]) {
    const block = publicReviewFunction(sql);
    assert.match(block, /review\.status = 'approved'/i);
    assert.match(block, /review\.publication_consent_at is not null/i);
    assert.match(block, /order by review\.submitted_at desc, review\.id desc[\s\S]*limit 5/i);
    assert.match(block, /'verified_student', true/i);
    assert.doesNotMatch(block, /'student_id'/i);
    assert.match(sql, /grant execute on function public\.get_public_student_reviews\(text\) to anon, authenticated, service_role/i);
  }
});

test("student page collects five-star rating, comment, display name preference and consent", function () {
  const ratingInputs = studentPage.match(/name="rating" value="[1-5]"/g) || [];
  assert.equal(ratingInputs.length, 5);
  assert.match(studentPage, /id="reviewComment"/);
  assert.match(studentPage, /id="reviewPublicationConsent"/);
  assert.match(studentPage, /value="full"/);
  assert.match(studentPage, /value="first_initial"/);
  assert.match(studentPage, /<meta name="robots" content="noindex, nofollow">/i);
  assert.match(studentApp, /rpc\("submit_my_student_review"/);
  assert.match(studentApp, /rpc\("delete_my_student_review"/);
});

test("teacher moderation page approves or rejects reviews without exposing it to indexing", function () {
  assert.match(adminPage, /<meta name="robots" content="noindex, nofollow">/i);
  assert.match(adminPage, /id="reviewStatusFilter"/);
  assert.match(adminApp, /rpc\("get_teacher_student_reviews"/);
  assert.match(adminApp, /rpc\("moderate_teacher_student_review"/);
  assert.match(adminApp, /window\.Auth\.isTeacherAdmin\(\)/);
});

test("commercial pages render the correct five-review feed without review structured data", function () {
  assert.match(groupPage, /data-student-reviews data-lesson-type="group"/);
  assert.match(individualPage, /data-student-reviews data-lesson-type="individual"/);
  assert.match(groupPage, /student_reviews_public\.js\?v=20261008-1/);
  assert.match(individualPage, /student_reviews_public\.js\?v=20261008-1/);
  assert.match(groupPage, /student_reviews_public\.css\?v=20261008-1/);
  assert.match(individualPage, /student_reviews_public\.css\?v=20261008-1/);
  assert.doesNotMatch(groupPage, /"@type"\s*:\s*"Review"/i);
  assert.doesNotMatch(individualPage, /"@type"\s*:\s*"Review"/i);
  assert.doesNotMatch(groupPage, /AggregateRating/i);
  assert.doesNotMatch(individualPage, /AggregateRating/i);
});

test("public review renderer uses the safe public RPC and DOM text nodes", function () {
  assert.match(publicScript, /rest\/v1\/rpc\/get_public_student_reviews/);
  assert.match(publicScript, /target_lesson_type: lessonType/);
  assert.match(publicScript, /comment\.textContent = review\.comment/);
  assert.match(publicScript, /strong\.textContent = review\.display_name/);
  assert.doesNotMatch(publicScript, /innerHTML\s*=/);
});

test("student and professor dashboards link to their review workflows", function () {
  assert.match(studentArea, /href="\/avaliar-aulas\/"/);
  assert.match(professor, /href="\/avaliacoes-dos-alunos\/"[^>]*data-card-id="avaliacoes-dos-alunos"/);
  assert.match(professorIcons, /'avaliacoes-dos-alunos':\s*'<svg/);
});

test("privacy policy documents voluntary public reviews and withdrawal", function () {
  assert.match(privacy, /avaliações voluntárias das aulas/i);
  assert.match(privacy, /Publicar avaliações voluntárias/i);
  assert.match(privacy, /Consentimento, que pode ser retirado pelo aluno/i);
  assert.match(privacy, /href="\/avaliar-aulas\/"[^>]*>Avaliar minhas aulas</i);
});
