/**
 * TAREFAS PARA CASA — HTTP end-to-end, local Supabase disposable instance only.
 * Manual live mode makes one GPT-6 Luna request, using only synthetic data.
 * All database connections stay local. Never run this against production.
 */
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const ORIGIN = 'https://teacherflavius.com';
const READING = '25000000-0000-4000-8000-000000000021';
const WRITING = '25000000-0000-4000-8000-000000000022';
const GRAMMAR = '25000000-0000-4000-8000-000000000023';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localConfig() {
  const output = execFileSync('supabase', ['status', '-o', 'env'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  const env = {};
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  const api = env.API_URL || 'http://127.0.0.1:54321';
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(api)) {
    throw new Error('Refusing to run a synthetic test against a nonlocal project.');
  }
  const anon = env.ANON_KEY;
  const service = env.SERVICE_ROLE_KEY;
  if (!anon || !service) {
    throw new Error('Local Supabase JWT keys unavailable; never use production credentials.');
  }
  return { api, anon, service };
}

async function apiFetch(url, init, expectedStatus) {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, JSON.stringify({
    endpoint: new URL(url).pathname, status: response.status,
    error: typeof data.error === 'string' ? data.error : data.msg || data.message || null,
  }));
  return data;
}

function authorizedHeaders(key, bearer = key) {
  return {
    apikey: key, authorization: 'Bearer ' + bearer,
    'Content-Type': 'application/json',
  };
}

async function createSyntheticUser(config, suffix) {
  const email = 'stage5-http-' + suffix + '-' + randomUUID() + '@example.test';
  const password = 'Test-only-' + randomUUID() + '!Aa2';
  const result = await apiFetch(config.api + '/auth/v1/admin/users', {
    method: 'POST', headers: authorizedHeaders(config.service),
    body: JSON.stringify({ email, password, email_confirm: true }),
  }, 200);
  assert.match(result.id, UUID);
  const session = await apiFetch(config.api + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: authorizedHeaders(config.anon),
    body: JSON.stringify({ email, password }),
  }, 200);
  assert.ok(session.access_token);
  return { id: result.id, jwt: session.access_token };
}

function dockerSql(sql, studentA, studentB, tuplesOnly = false) {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).split(/\r?\n/);
  const container = names.find(name => /^supabase_db_[\w-]+$/.test(name));
  if (!container) throw new Error('Disposable Supabase database container not found.');
  const args = ['exec', '-i', container, 'psql', '-U', 'postgres',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
  if (tuplesOnly) args.push('-At');
  if (studentA && studentB) {
    assert.match(studentA, UUID);
    assert.match(studentB, UUID);
    args.push('-v', 'student_a=' + studentA, '-v', 'student_b=' + studentB);
  }
  return execFileSync('docker', args, { input: sql, encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'] });
}

async function edge(config, jwt, action, fields = {}, options = {}) {
  const response = await fetch(config.api + '/functions/v1/homework-student', {
    method: 'POST',
    headers: {
      ...authorizedHeaders(config.anon, jwt),
      Origin: options.origin || ORIGIN,
    },
    body: JSON.stringify({ action, ...fields }),
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function waitForEdge(config) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const result = await edge(config, 'not-a-real-jwt', 'list');
      if ([401, 403].includes(result.status)) return;
      // A gateway 503 during startup should not be accepted as readiness.
    } catch {
      // Service has not bound to the local TCP port yet.
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error('Local Edge service failed to respond to authenticated requests.');
}

async function run() {
  const liveWriting = process.env.HOMEWORKS_LIVE_WRITING === 'true';
  if (liveWriting && process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Live Writing test requires explicit manual workflow_dispatch.');
  }
  const config = localConfig();
  await waitForEdge(config);
  const studentA = await createSyntheticUser(config, 'a');
  const studentB = await createSyntheticUser(config, 'b');

  const fixture = readFileSync(path.join(__dirname, 'sql',
    'homeworks_stage5_http_fixture.sql'), 'utf8');
  dockerSql(fixture, studentA.id, studentB.id);

  // Prior to temporary test-only launch, even valid JWTs must be denied.
  const locked = await edge(config, studentA.jwt, 'list');
  assert.equal(locked.status, 403);
  assert.match(locked.body.error, /disponibilizado/i);

  // This flag change exists only in the CI database destroyed after the job.
  dockerSql('update public.homework_release_control set enabled=true where id=1;');

  const anonymous = await edge(config, 'invalid-session', 'list');
  assert.equal(anonymous.status, 401);
  const wrongOrigin = await edge(config, studentA.jwt, 'list', {}, {
    origin: 'https://not-teacherflavius.example.test',
  });
  assert.equal(wrongOrigin.status, 403);

  const aList = await edge(config, studentA.jwt, 'list');
  const bList = await edge(config, studentB.jwt, 'list');
  assert.equal(aList.status, 200, JSON.stringify(aList.body));
  assert.equal(bList.status, 200, JSON.stringify(bList.body));
  assert.deepEqual(aList.body.assignments.map(x => x.assignment_id), [READING, WRITING]);
  assert.deepEqual(bList.body.assignments.map(x => x.assignment_id), [GRAMMAR]);

  const foreignDetail = await edge(config, studentB.jwt, 'detail', {
    assignment_id: READING,
  });
  assert.equal(foreignDetail.status, 404);

  const reading = await edge(config, studentA.jwt, 'detail', {
    assignment_id: READING,
  });
  assert.equal(reading.status, 200, JSON.stringify(reading.body));
  assert.equal(reading.body.questions.length, 10);
  assert.equal(reading.body.activity_type, 'reading');
  assert.equal(reading.body.content.passage, 'The class starts at nine.');
  assert.equal(JSON.stringify(reading.body).includes('secret_answer'), false);
  assert.equal(JSON.stringify(reading.body).includes('answer_key'), false);

  const readingAnswers = reading.body.questions.map((q, index) => ({
    question_id: q.id, response: index === 0 ? 'no' : 'YES',
  }));
  const key = randomUUID();
  const graded = await edge(config, studentA.jwt, 'submit', {
    assignment_id: READING, submission_key: key, answers: readingAnswers,
  });
  assert.equal(graded.status, 200, JSON.stringify(graded.body));
  assert.equal(graded.body.status, 'evaluated');
  assert.equal(graded.body.score, 9);
  assert.equal(graded.body.feedback[0].source, 'automatic');
  const reused = await edge(config, studentA.jwt, 'submit', {
    assignment_id: READING, submission_key: key, answers: readingAnswers,
  });
  assert.equal(reused.status, 200);
  assert.equal(reused.body.attempt_id, graded.body.attempt_id);
  assert.equal(reused.body.reused, true);
  const progress = await edge(config, studentA.jwt, 'progress', {
    assignment_id: READING,
  });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.score, 9);

  const writingDetail = await edge(config, studentA.jwt, 'detail', {
    assignment_id: WRITING,
  });
  assert.equal(writingDetail.status, 200);
  assert.equal(writingDetail.body.activity_type, 'writing');
  assert.equal(writingDetail.body.questions.length, 0);
  const writing = await edge(config, studentA.jwt, 'submit', {
    assignment_id: WRITING, submission_key: randomUUID(),
    answers: { text: 'Yesterday I go to school and I studied English.' },
  });
  assert.equal(writing.status, 200, JSON.stringify(writing.body));
  if (liveWriting) {
    assert.equal(writing.body.status, 'evaluated',
      'A provider failure must not be mistaken for completed Writing.');
    assert.equal(writing.body.correction, undefined);
    assert.ok(Number.isFinite(writing.body.score) &&
      writing.body.score >= 0 && writing.body.score <= 10);
    assert.equal(writing.body.feedback.length, 1);

    const feedback = writing.body.feedback[0];
    assert.equal(feedback.source, 'ai');
    assert.equal(feedback.score, writing.body.score);
    assert.equal(feedback.original_text,
      'Yesterday I go to school and I studied English.');
    assert.ok(typeof feedback.corrected_text === 'string' &&
      feedback.corrected_text.trim().length > 0);
    assert.ok(typeof feedback.general_comment === 'string' &&
      feedback.general_comment.length >= 10);
    assert.ok(feedback.explanations.length >= 3 &&
      feedback.explanations.length <= 12);

    const gradeFor = (index, weight) => {
      const text = feedback.explanations[index];
      const match = text.match(new RegExp(
        ':\\s*(\\d+(?:\\.\\d+)?)\\/10 \\(peso ' + weight + '%\\)'));
      assert.ok(match, 'Each rubric component must be visible in the feedback.');
      return Number(match[1]);
    };
    const completion = gradeFor(0, 40);
    const accuracy = gradeFor(1, 30);
    const vocabulary = gradeFor(2, 30);
    const expectedScore = Number((
      completion * 0.4 + accuracy * 0.3 + vocabulary * 0.3
    ).toFixed(2));
    assert.equal(writing.body.score, expectedScore,
      'The stored grade must use the canonical 40/30/30 weighting.');

    // An evaluated attempt is read from storage, never sent to the provider again.
    const retry = await edge(config, studentA.jwt, 'retry_correction', {
      assignment_id: WRITING,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, 'evaluated');
    assert.equal(retry.body.score, expectedScore);
    assert.equal(retry.body.feedback.length, 1);

    const consumed = dockerSql(
      "select count(*) from public.api_rate_limit_buckets " +
      "where bucket_key like 'homework-writing:%' and request_count=1;",
      undefined, undefined, true
    ).trim();
    assert.equal(consumed, '2',
      'Exactly one Writing request consumes one hourly and one daily counter.');

    const stored = dockerSql(
      "select count(*) from public.exercise_feedback " +
      "where source='ai' and evaluator_model='gpt-6-luna';",
      undefined, undefined, true
    ).trim();
    assert.equal(stored, '1', 'The real assessment must be saved only once.');

    const budget = dockerSql(
      "select count(*) from public.homework_ai_budget_months " +
      "where limit_micro_usd=5000000 and spent_micro_usd between 1 and 4700 " +
      "and reserved_micro_usd=0;",
      undefined, undefined, true
    ).trim();
    assert.equal(budget, '1', 'Real provider tokens must settle against the monthly budget.');
    const charges = dockerSql(
      "select count(*) from public.homework_ai_budget_calls " +
      "where actual_micro_usd is not null and settled_at is not null;",
      undefined, undefined, true
    ).trim();
    assert.equal(charges, '1', 'Exactly one Writing model call must be accounted.');
  } else {
    const budget = dockerSql(
      "select count(*) from public.homework_ai_budget_calls;",
      undefined, undefined, true
    ).trim();
    assert.equal(budget, '0', 'Missing provider credentials must not reserve budget.');
    assert.equal(writing.body.status, 'submitted');
    assert.equal(writing.body.score, null);
    assert.equal(writing.body.correction, 'unconfigured');
    const retry = await edge(config, studentA.jwt, 'retry_correction', {
      assignment_id: WRITING,
    });
    assert.equal(retry.status, 200);
    assert.equal(retry.body.status, 'submitted');
    assert.equal(retry.body.correction, 'unconfigured');
  }

  const writingProgress = await edge(config, studentA.jwt, 'progress', {
    assignment_id: WRITING,
  });
  assert.equal(writingProgress.status, 200);
  assert.equal(writingProgress.body.status, liveWriting ? 'evaluated' : 'submitted');
  if (liveWriting) {
    assert.equal(writingProgress.body.score, writing.body.score);
    assert.equal(writingProgress.body.feedback[0].source, 'ai');
  }

  const grammarDetail = await edge(config, studentB.jwt, 'detail', {
    assignment_id: GRAMMAR,
  });
  assert.equal(grammarDetail.status, 200);
  assert.equal(grammarDetail.body.activity_type, 'grammar');
  const grammar = await edge(config, studentB.jwt, 'submit', {
    assignment_id: GRAMMAR, submission_key: randomUUID(),
    answers: [{
      question_id: grammarDetail.body.questions[0].id, response: 'studies',
    }],
  });
  assert.equal(grammar.status, 200, JSON.stringify(grammar.body));
  assert.equal(grammar.body.status, 'evaluated');
  assert.equal(grammar.body.score, 10);

  const foreignProgress = await edge(config, studentA.jwt, 'progress', {
    assignment_id: GRAMMAR,
  });
  assert.equal(foreignProgress.status, 404);

  dockerSql('update public.homework_release_control set enabled=false where id=1;');
  const blockedAgain = await edge(config, studentA.jwt, 'progress', {
    assignment_id: WRITING,
  });
  assert.equal(blockedAgain.status, 403);

  process.stdout.write(
    'PASS: true JWT, gate, per-user access, hidden answer keys, Reading/Grammar grades, ' +
    (liveWriting ? 'Live Writing stored/recovered with canonical 40/30/30 score; ' :
      'Writing saved retry without provider; ') +
    'idempotency and block restoration.\\n',
  );
}

run().catch(error => {
  console.error('Homeworks local HTTP integration failed:', error.message);
  process.exitCode = 1;
});
