const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const EDGE_PATH = path.join(ROOT, 'supabase/functions/homework-student/index.ts');
const ORIGIN = 'https://teacherflavius.com';
const STUDENT = '00000000-0000-4000-8000-000000000001';
const OTHER_STUDENT = '00000000-0000-4000-8000-000000000002';
const ASSIGNMENT = '00000000-0000-4000-8000-000000000011';
const VERSION = '00000000-0000-4000-8000-000000000012';
const EXERCISE = '00000000-0000-4000-8000-000000000013';
const ATTEMPT = '00000000-0000-4000-8000-000000000014';
const SUBMISSION = '00000000-0000-4000-8000-000000000015';
const TOKEN = '00000000-0000-4000-8000-000000000016';

function compileEdge(source) {
  const importsRemoved = source.replace(/^import .*;\s*$/gm, '');
  // Node's type stripper does not lower TypeScript parameter properties.
  // Keep the constructor's JavaScript semantics intact for the test runtime.
  const runnable = importsRemoved.replace(
    'constructor(message: string, public readonly status: number) {\n    super(message);\n  }',
    'constructor(message: string, status: number) {\n    super(message);\n    this.status = status;\n  }'
  );
  assert.notEqual(runnable, importsRemoved, 'Unexpected ClientError constructor change');
  return stripTypeScriptTypes(runnable);
}

function fakeData(overrides = {}) {
  return {
    released: false,
    archived: false,
    assignedTo: STUDENT,
    writing: true,
    aiEnabled: true,
    aiStatus: 200,
    aiScore: 8,
    ...overrides,
  };
}

function buildHarness(overrides = {}) {
  const config = fakeData(overrides);
  const calls = { tables: [], rpc: [], ai: [] };
  const record = { attempt: null, feedback: [] };
  let handler;
  const activity = config.writing ? 'writing' : 'reading';
  const allRows = {
    homework_release_control: [{ id: 1, enabled: config.released }],
    profiles: [{ id: STUDENT, enrolled: true, archived: config.archived }],
    exercise_assignments: [{ id: ASSIGNMENT, student_id: config.assignedTo,
      exercise_id: EXERCISE, version_id: VERSION, status: 'assigned' }],
    exercises: [{ id: EXERCISE, activity_type: activity, title: 'Task 1',
      exercise_number: 1, status: 'published', published_version_id: VERSION }],
    exercise_versions: [{ id: VERSION, exercise_id: EXERCISE, status: 'approved',
      version_number: 1, content: { prompt: 'Write about your day',
        passage: 'A short passage', secret_answer: 'not-for-students' } }],
    exercise_questions: [{ id: TOKEN, version_id: VERSION, position: 1,
      prompt: 'What happens?', question_type: 'short_answer', options: [],
      points: 1, answer_key: { correct: 'A private answer' } }],
  };

  function table(name) {
    const filters = {};
    let columns = '*';
    const query = {
      select(value) { columns = value; return this; },
      eq(field, value) { filters[field] = value; return this; },
      order() { return this; },
      limit() { return this; },
      maybeSingle() { return Promise.resolve({ data: entries()[0] || null, error: null }); },
      single() { return Promise.resolve({ data: entries()[0] || null, error: null }); },
      then(resolve, reject) { return Promise.resolve({ data: entries(), error: null }).then(resolve, reject); },
    };
    function entries() {
      calls.tables.push({ name, columns, filters: { ...filters } });
      const source = name === 'exercise_attempts' ? (record.attempt ? [record.attempt] : [])
        : name === 'exercise_feedback' ? record.feedback : allRows[name] || [];
      return source.filter(row => Object.entries(filters).every(([field, value]) =>
        row[field] === value)).map(row => {
        if (columns === '*') return { ...row };
        return Object.fromEntries(columns.split(',').map(key => key.trim())
          .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]));
      });
    }
    return query;
  }

  async function rpc(name, args) {
    calls.rpc.push({ name, args });
    if (name === 'homework_submit') {
      if (record.attempt) return { data: { attempt_id: ATTEMPT, activity_type: activity,
        status: record.attempt.status, score: record.attempt.score, reused: true }, error: null };
      record.attempt = { id: ATTEMPT, assignment_id: ASSIGNMENT, student_id: STUDENT,
        status: 'submitted', score: null };
      return { data: { attempt_id: ATTEMPT, activity_type: activity,
        status: 'submitted', score: null, reused: false }, error: null };
    }
    if (name === 'consume_api_rate_limit') return { data: config.rateLimit !== false, error: null };
    if (name === 'homework_claim_writing') return { data: { status: 'claimed', token: TOKEN,
      prompt: 'Write about your day', text: 'I go to school and I study English.' }, error: null };
    if (name === 'homework_complete_writing') {
      record.attempt.status = 'evaluated';
      record.attempt.score = args.p_score;
      const feedback = { attempt_id: ATTEMPT, source: 'ai', score: args.p_score,
        general_comment: args.p_comment, original_text: 'I go to school and I study English.',
        corrected_text: args.p_corrected, explanations: args.p_explanations };
      record.feedback.push(feedback);
      return { data: feedback, error: null };
    }
    if (name === 'homework_release_writing_lease') return { data: null, error: null };
    throw new Error('Unexpected RPC: ' + name);
  }

  const admin = { from: table, rpc };
  const user = { auth: { getUser: async token => ({
    data: { user: token === 'valid-session' ? { id: STUDENT } : null },
    error: token === 'valid-session' ? null : { message: 'invalid' },
  }) } };
  const env = {
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'public',
    SUPABASE_SERVICE_ROLE_KEY: 'internal-test-only',
    ...(config.aiEnabled ? { OPENAI_API_KEY: 'server-test-only' } : {}),
  };
  const sandbox = {
    Deno: { env: { get: key => env[key] }, serve: callback => { handler = callback; } },
    createClient: (_url, key) => key === 'public' ? user : admin,
    AbortController, Response, setTimeout, clearTimeout,
    console: { error() {} },
    fetch: async (url, options) => {
      calls.ai.push({ url, options });
      return new Response(JSON.stringify({ status: 'completed', output: [{
        content: [{ type: 'output_text', text: JSON.stringify({
          score: config.aiScore, general_comment: 'Good effort in your writing.',
          corrected_text: 'I went to school and studied English.',
          explanations: ['Use past tense to describe yesterday.'],
        }) }],
      }] }), { status: config.aiStatus, headers: { 'Content-Type': 'application/json' } });
    },
  };
  vm.runInNewContext(compileEdge(fs.readFileSync(EDGE_PATH, 'utf8')), sandbox,
    { filename: 'homework-student/index.ts', timeout: 2000 });

  async function request(body, { token = 'valid-session', origin = ORIGIN, method = 'POST' } = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const response = await handler({
      method, headers: new Headers({ ...(token ? { authorization: 'Bearer ' + token } : {}),
        ...(origin ? { Origin: origin } : {}) }),
      text: async () => payload,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  return { request, calls, record };
}

test('student Edge rejects invalid origins, sessions and methods before accessing homework', async () => {
  const h = buildHarness();
  assert.equal((await h.request({ action: 'list' }, { origin: 'https://evil.test' })).status, 403);
  assert.equal((await h.request({ action: 'list' }, { token: '' })).status, 401);
  assert.equal((await h.request({ action: 'list' }, { method: 'GET' })).status, 405);
});

test('global release gate denies even a valid student session', async () => {
  const h = buildHarness();
  const response = await h.request({ action: 'list' });
  assert.equal(response.status, 403);
  assert.equal(h.calls.rpc.length, 0);
  assert.deepEqual(h.calls.tables.map(entry => entry.name), ['homework_release_control']);
});

test('archived students cannot access an otherwise released assignment', async () => {
  const h = buildHarness({ released: true, archived: true });
  assert.equal((await h.request({ action: 'list' })).status, 403);
});

test('ownership check blocks other students and a valid detail never leaks answer keys', async () => {
  const other = buildHarness({ released: true, assignedTo: OTHER_STUDENT });
  assert.equal((await other.request({ action: 'detail', assignment_id: ASSIGNMENT })).status, 404);
  const allowed = buildHarness({ released: true, writing: false });
  const result = await allowed.request({ action: 'detail', assignment_id: ASSIGNMENT });
  assert.equal(result.status, 200);
  assert.equal(result.body.questions[0].prompt, 'What happens?');
  assert.equal(JSON.stringify(result.body).includes('answer_key'), false);
  assert.equal(JSON.stringify(result.body).includes('secret_answer'), false);
});

test('Writing is persisted, assessed by mocked AI and visible through progress', async () => {
  const h = buildHarness({ released: true });
  const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'evaluated');
  assert.equal(result.body.score, 8);
  assert.equal(h.calls.rpc.filter(entry => entry.name === 'homework_submit').length, 1);
  assert.equal(h.calls.ai.length, 1);
  const providerBody = JSON.parse(h.calls.ai[0].options.body);
  assert.equal(providerBody.store, false);
  assert.equal(providerBody.model, 'gpt-6-luna');
  assert.equal(providerBody.reasoning.effort, 'none');
  assert.equal(providerBody.max_output_tokens, 1400);
  assert.equal(providerBody.text.format.type, 'json_schema');
  assert.equal(providerBody.text.format.strict, true);
  assert.equal(h.calls.ai[0].options.headers.Authorization, 'Bearer server-test-only');
  assert.equal(JSON.stringify(providerBody).includes(STUDENT), false);
  const progress = await h.request({ action: 'progress', assignment_id: ASSIGNMENT });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.feedback[0].score, 8);
});

test('failed AI assessment never fabricates a score and can retry idempotently', async () => {
  const h = buildHarness({ released: true, aiStatus: 503 });
  const payload = { action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } };
  const first = await h.request(payload);
  const second = await h.request(payload);
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'submitted');
  assert.equal(first.body.correction, 'retry');
  assert.equal(second.body.reused, true);
  assert.equal(h.record.attempt.score, null);
  assert.equal(h.calls.rpc.filter(entry => entry.name === 'homework_release_writing_lease').length, 2);
});

test('when AI credentials are not configured, Writing stays submitted', async () => {
  const h = buildHarness({ released: true, aiEnabled: false });
  const response = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.correction, 'unconfigured');
  assert.equal(response.body.score, null);
  assert.equal(h.calls.ai.length, 0);
});
