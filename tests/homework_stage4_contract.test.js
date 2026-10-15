const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const sql = read("supabase/migrations/20261015052321_homeworks_stage4_submission.sql");
const edge = read("supabase/functions/homework-student/index.ts");

function studentService(calls, error) {
  const client = {
    functions: {
      invoke: async (name, options) => {
        calls.push([name, options.body]);
        return error ? { data: null, error: { message: error } }
          : { data: { status: "submitted" }, error: null };
      }
    }
  };
  const context = { window: { crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" } } };
  vm.runInNewContext(read("homework_student_service.js"), context);
  return { service: context.window.HomeworkStudentService, auth: { getClient: () => client } };
}

test("new module remains globally disabled until a separate release authorization", () => {
  assert.match(sql, /enabled boolean not null default false/);
  assert.match(sql, /values \(1, false\)/);
  assert.match(sql, /revoke all on public\.homework_release_control from public, anon, authenticated/);
  assert.match(sql, /if not \(select public\.homework_is_released\(\)\) then/);
  assert.match(edge, /enabled\?\.enabled !== true/);
  assert.doesNotMatch(edge, /update\(\{\s*enabled:\s*true/);
});

test("student RLS is read-only, owner-restricted and does not expose answer keys", () => {
  for (const table of ["exercise_assignments", "exercise_attempts",
    "exercise_answers", "exercise_feedback"]) {
    assert.match(sql, new RegExp("on public\\." + table + "\\s+for select to authenticated"));
  }
  assert.match(sql, /student_id = \(select auth\.uid\(\)\)/);
  assert.match(sql, /grant select \(id, assignment_id, version_id, student_id, attempt_number/);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete) on public\.exercise_answers to authenticated/);
  assert.match(edge, /select\("id,position,prompt,question_type,options,points"\)/);
  assert.match(edge, /function studentContent\(/);
  assert.match(edge, /content: studentContent\(exercise\.activity_type, version\.content\)/);
  assert.doesNotMatch(edge, /content: version\.content/);
  assert.doesNotMatch(edge, /select\([^\n]*answer_key/);
  assert.match(edge, /eq\("student_id", userId\)/);
});

test("server verifies identity and does not trust a submitted student_id", () => {
  assert.match(edge, /auth\.getUser\(/);
  assert.match(edge, /const userId = identity\.user\.id/);
  assert.match(edge, /p_student_id: userId/);
  assert.match(edge, /requireActiveStudent\(admin, userId\)/);
  assert.match(edge, /requireAssignment\(admin, userId, id\)/);
  assert.match(sql, /assigned\.student_id <> p_student_id/);
  assert.match(sql, /assigned\.status <> 'assigned'/);
  assert.match(sql, /target\.published_version_id is distinct from assigned\.version_id/);
});

test("submissions are transactional, idempotent and reject cross-exercise questions", () => {
  assert.match(sql, /p_submission_key uuid/);
  assert.match(sql, /for update/);
  assert.match(sql, /prior\.submission_key <> p_submission_key/);
  assert.match(sql, /where id = \(item->>'question_id'\)::uuid and version_id = assigned\.version_id/);
  assert.match(sql, /question_row\.id = any\(questions_seen\)/);
  assert.match(sql, /exercise_attempts_one_official_submission/);
  assert.match(sql, /if pending_review = 0 then/);
  assert.match(sql, /question_row\.question_type = 'short_answer'/);
  assert.match(sql, /\(select count\(\*\) from jsonb_object_keys\(p_payload\)\)/);
});

test("Writing correction runs server-side with privacy, lease and bounded rubric", () => {
  assert.match(edge, /Deno\.env\.get\("OPENAI_API_KEY"\)/);
  assert.match(edge, /api\.openai\.com\/v1\/responses/);
  assert.match(edge, /store: false/);
  assert.match(edge, /max_output_tokens: 1400/);
  assert.match(edge, /strict: true/);
  assert.match(edge, /consumeRateLimit\(admin, userId\)/);
  assert.match(edge, /homework_claim_writing/);
  assert.match(edge, /homework_complete_writing/);
  assert.match(edge, /homework_release_writing_lease/);
  assert.match(sql, /target\.evaluation_token is distinct from p_token/);
  assert.match(sql, /source = 'ai'/);
  assert.match(sql, /p_score < 0 or p_score > 10/);
  assert.doesNotMatch(read("homework_student_service.js"), /OPENAI_API_KEY|service_role/);
});

test("client preserves idempotency key on retries and propagates failure", async () => {
  const calls = [];
  const { service, auth } = studentService(calls);
  const submission = service.makeSubmission("assignment-id", { text: "Hello world." });
  assert.equal(submission.submission_key, "00000000-0000-4000-8000-000000000001");
  await service.submit(auth, submission);
  await service.submit(auth, submission);
  assert.deepEqual(calls[0], calls[1]);
  assert.equal(calls[0][0], "homework-student");
  assert.equal(calls[0][1].action, "submit");
  await service.list(auth);
  await service.detail(auth, "assignment-id");
  await service.progress(auth, "assignment-id");
  assert.deepEqual(calls.slice(2).map(entry => entry[1].action),
    ["list", "detail", "progress"]);
  const failure = studentService([], "Sem acesso.");
  await assert.rejects(() => failure.service.submit(failure.auth, submission), /Sem acesso/);
  await assert.rejects(() => service.submit(null, submission), /Autenticação indisponível/);
});

test("private preview and SEO boundaries remain intact", () => {
  const html = read("area-do-estudante/homeworks/index.html");
  assert.match(html, /noindex, nofollow, noarchive/);
  assert.doesNotMatch(html, /homework_student_service\.js/);
  assert.doesNotMatch(html, /href="\/atividade_\d+\//);
  assert.doesNotMatch(html, /OPENAI_API_KEY/);
});
