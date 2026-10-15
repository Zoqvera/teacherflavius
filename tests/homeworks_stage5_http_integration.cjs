/**
 * TAREFAS PARA CASA — HTTP end-to-end, local Supabase disposable instance only.
 * No production network URLs, provider keys, real students, email or permanent data.
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

function dockerSql(sql, studentA, studentB) {
  const names = execFileSync('docker', ['ps', '--format', '{{.Names}}'], {
    encoding: 'utf8',
  }).split(/\r?\n/);
  const container = names.find(name => /^supabase_db_[\w-]+$/.test(name));
  if (!container) throw new Error('Disposable Supabase database container not found.');
  const args = ['exec', '-i', container, 'psql', '-U', 'postgres',
    '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'];
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
  assert.equal(writing.body.status, 'submitted');
  assert.equal(writing.body.score, null);
  assert.equal(writing.body.correction, 'unconfigured');
  const retry = await edge(config, studentA.jwt, 'retry_correction', {
    assignment_id: WRITING,
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'submitted');
  assert.equal(retry.body.correction, 'unconfigured');
  const writingProgress = await edge(config, studentA.jwt, 'progress', {
    assignment_id: WRITING,
  });
  assert.equal(writingProgress.status, 200);
  assert.equal(writingProgress.body.status, 'submitted');

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
    'Writing saved retry without provider, idempotency and block restoration.\n',
  );
}

run().catch(error => {
  console.error('Homeworks local HTTP integration failed:', error.message);
  process.exitCode = 1;
});
