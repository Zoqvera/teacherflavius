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
    dateOfBirth: '1990-05-15',
    ageVerified: true,
    aiAssessment: null,
    ...overrides,
  };
}

function buildHarness(overrides = {}) {
  const config = fakeData(overrides);
  const calls = { tables: [], rpc: [], ai: [], logs: [] };
  const record = { attempt: null, feedback: [] };
  let handler;
  const activity = config.writing ? 'writing' : 'reading';
  const month = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit',
  }).formatToParts(new Date());
  const monthKey = month.find(part => part.type === 'year').value + '-' +
    month.find(part => part.type === 'month').value + '-01';
  const allRows = {
    homework_release_control: [{ id: 1, enabled: config.released }],
    homework_ai_budget_months: config.remainingBudgetMicros == null ? [] : [{
      month_start: monthKey, limit_micro_usd: 5000000,
      spent_micro_usd: 5000000 - config.remainingBudgetMicros,
      reserved_micro_usd: 0,
    }],
    profiles: [{ id: STUDENT, enrolled: true, archived: config.archived,
      date_of_birth: config.dateOfBirth }],
    homework_writing_age_verifications: config.ageVerified == null ? [] : [{
      student_id: STUDENT, verified_adult: config.ageVerified,
    }],
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
    if (name === config.rpcError) return {
      data: null,
      error: { message: 'private-student-mail@example.test student submitted text' },
    };
    if (name === 'homework_submit') {
      if (record.attempt) return { data: { attempt_id: ATTEMPT, activity_type: activity,
        status: record.attempt.status, score: record.attempt.score, reused: true }, error: null };
      record.attempt = { id: ATTEMPT, assignment_id: ASSIGNMENT, student_id: STUDENT,
        status: 'submitted', score: null };
      return { data: { attempt_id: ATTEMPT, activity_type: activity,
        status: 'submitted', score: null, reused: false }, error: null };
    }
    if (name === 'consume_api_rate_limit') return { data: config.rateLimit !== false, error: null };
    if (name === 'homework_ai_budget_reserve') return {
      data: { allowed: config.monthBudget !== false,
        reserved_micro_usd: 4700 }, error: null,
    };
    if (name === 'homework_ai_budget_settle') return {
      data: { settled: true, charged_micro_usd:
        Math.ceil(args.p_input_tokens / 10 + args.p_output_tokens / 2) },
      error: null,
    };
    if (name === 'homework_claim_writing') return {
      data: { status: config.claimStatus || 'claimed', token: TOKEN,
        prompt: 'Write about your day', text: 'I go to school and I study English.' },
      error: null,
    };
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
    console: { error(...values) { calls.logs.push(values.map(String).join(' ')); } },
    fetch: async (url, options) => {
      calls.ai.push({ url, options });
      return new Response(JSON.stringify({ status: 'completed', output: [{
        content: [{ type: 'output_text', text: JSON.stringify({
          ...(config.aiAssessment || {
            criteria: {
              task_completion: config.aiScore,
              linguistic_accuracy: config.aiScore,
              clarity_vocabulary: config.aiScore,
            },
            general_comment: 'Good effort in your writing.',
            corrected_text: 'I went to school and studied English.',
            explanations: ['Use past tense to describe yesterday.'],
          }),
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
  return { request, calls, record, setAiStatus: status => { config.aiStatus = status; } };
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
  assert.equal(h.calls.rpc.filter(entry =>
    entry.name === 'homework_ai_budget_reserve').length, 1);
  assert.equal(h.calls.rpc.filter(entry =>
    entry.name === 'homework_ai_budget_settle').length, 1);
  const reservedAt = h.calls.rpc.findIndex(entry =>
    entry.name === 'homework_ai_budget_reserve');
  const settledAt = h.calls.rpc.findIndex(entry =>
    entry.name === 'homework_ai_budget_settle');
  assert.ok(reservedAt < settledAt, 'must reserve before settling a request');
  assert.equal(h.calls.rpc[settledAt].args.p_input_tokens, 40000);
  assert.equal(h.calls.rpc[settledAt].args.p_output_tokens, 1400);
  const providerBody = JSON.parse(h.calls.ai[0].options.body);
  assert.equal(providerBody.store, false);
  assert.equal(providerBody.model, 'gpt-6-luna');
  assert.equal(providerBody.reasoning.effort, 'none');
  assert.equal(providerBody.max_output_tokens, 1400);
  assert.equal(providerBody.text.format.type, 'json_schema');
  assert.equal(providerBody.text.format.strict, true);
  const schema = providerBody.text.format.schema;
  assert.deepEqual(schema.required,
    ['criteria', 'general_comment', 'corrected_text', 'explanations']);
  assert.deepEqual(schema.properties.criteria.required,
    ['task_completion', 'linguistic_accuracy', 'clarity_vocabulary']);
  assert.equal(schema.properties.criteria.additionalProperties, false);
  assert.equal(schema.properties.criteria.properties.task_completion.minimum, 0);
  assert.equal(schema.properties.criteria.properties.task_completion.maximum, 10);
  assert.equal(h.calls.ai[0].options.headers.Authorization, 'Bearer server-test-only');
  assert.equal(JSON.stringify(providerBody).includes(STUDENT), false);
  const progress = await h.request({ action: 'progress', assignment_id: ASSIGNMENT });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.feedback[0].score, 8);
  assert.match(progress.body.feedback[0].explanations[0],
    /Cumprimento do enunciado: 8\/10 \(peso 40%\)/);
  assert.match(progress.body.feedback[0].explanations[1], /Precisão linguística: 8\/10/);
  assert.match(progress.body.feedback[0].explanations[2], /Clareza e vocabulário: 8\/10/);
});

test('monthly Writing budget pause survives progress reload without leaking accounting', async () => {
  const h = buildHarness({ released: true, monthBudget: false, remainingBudgetMicros: 3000 });
  const sent = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.correction, 'monthly_budget');
  assert.equal(h.calls.ai.length, 0);

  const reloaded = await h.request({ action: 'progress', assignment_id: ASSIGNMENT });
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.status, 'submitted');
  assert.equal(reloaded.body.correction, 'monthly_budget');
  assert.equal(reloaded.body.score, null);
  assert.equal(JSON.stringify(reloaded.body).includes('micro_usd'), false);

  const budgetQueries = h.calls.tables.filter(row => row.name === 'homework_ai_budget_months');
  assert.equal(budgetQueries.length, 1);
  assert.ok(budgetQueries[0].filters.month_start);
});

test('Writing progress allows correction again when the monthly budget refreshes', async () => {
  const h = buildHarness({ released: true, aiStatus: 503, remainingBudgetMicros: 4700 });
  await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  const progress = await h.request({ action: 'progress', assignment_id: ASSIGNMENT });
  assert.equal(progress.status, 200);
  assert.equal(progress.body.status, 'submitted');
  assert.equal(progress.body.correction, undefined);
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

test('Writing correction resumes after a reload without resending text or submitting again', async () => {
  const h = buildHarness({ released: true, aiStatus: 503 });
  const first = await h.request({
    action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' },
  });
  assert.equal(first.body.status, 'submitted');
  assert.equal(first.body.correction, 'retry');
  assert.equal(h.record.attempt.score, null);

  h.setAiStatus(200);
  const resumed = await h.request({ action: 'retry_correction', assignment_id: ASSIGNMENT });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.status, 'evaluated');
  assert.equal(resumed.body.score, 8);
  assert.equal(resumed.body.feedback[0].source, 'ai');
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_submit').length, 1);
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_claim_writing').length, 2);
  assert.equal(h.calls.ai.length, 2);

  const repeated = await h.request({ action: 'retry_correction', assignment_id: ASSIGNMENT });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.body.status, 'evaluated');
  assert.equal(h.calls.ai.length, 2, 'a corrected text cannot be charged again');
});

test('Writing recovery validates access and rejects nonexistent or non-Writing attempts', async () => {
  const locked = buildHarness();
  assert.equal((await locked.request({ action: 'retry_correction',
    assignment_id: ASSIGNMENT })).status, 403);
  assert.equal(locked.calls.ai.length, 0);

  const unauthorized = buildHarness({ released: true, assignedTo: OTHER_STUDENT });
  assert.equal((await unauthorized.request({ action: 'retry_correction',
    assignment_id: ASSIGNMENT })).status, 404);

  const notWriting = buildHarness({ released: true, writing: false });
  assert.equal((await notWriting.request({ action: 'retry_correction',
    assignment_id: ASSIGNMENT })).status, 422);

  const empty = buildHarness({ released: true });
  assert.equal((await empty.request({ action: 'retry_correction',
    assignment_id: ASSIGNMENT })).status, 404);
  assert.equal((await empty.request({ action: 'retry_correction',
    assignment_id: 'invalid-uuid' })).status, 400);
  assert.equal(empty.calls.ai.length, 0);
});

test('Writing retry respects missing API credentials without inventing a score', async () => {
  const h = buildHarness({ released: true, aiEnabled: false });
  await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  const response = await h.request({ action: 'retry_correction', assignment_id: ASSIGNMENT });
  assert.equal(response.status, 200);
  assert.equal(response.body.correction, 'unconfigured');
  assert.equal(response.body.status, 'submitted');
  assert.equal(h.calls.ai.length, 0);
});

test('Writing grade is weighted by the backend, not guessed as a total by AI', async () => {
  const h = buildHarness({ released: true, aiAssessment: {
    criteria: { task_completion: 8, linguistic_accuracy: 6, clarity_vocabulary: 9 },
    general_comment: 'The task was completed with some grammar issues.',
    corrected_text: 'I went to school and studied English.',
    explanations: ['Keep verb tenses consistent.'],
    score: 10, // Even a forged unweighted total cannot override the canonical formula.
  } });
  const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'evaluated');
  assert.equal(result.body.score, 7.7); // 8*40% + 6*30% + 9*30%.
  assert.equal(h.record.feedback.length, 1);
  assert.equal(h.record.feedback[0].score, 7.7);
  assert.equal(h.record.feedback[0].explanations.length, 4);
  assert.match(h.record.feedback[0].explanations[0], /8\/10.*40%/);
  assert.match(h.record.feedback[0].explanations[1], /6\/10.*30%/);
  assert.match(h.record.feedback[0].explanations[2], /9\/10.*30%/);
});

test('Writing assessment outside the rubric cannot create grades and remains recoverable', async () => {
  const invalidRubrics = [
    { task_completion: -1, linguistic_accuracy: 8, clarity_vocabulary: 8 },
    { task_completion: 8, linguistic_accuracy: 11, clarity_vocabulary: 8 },
    { task_completion: '10', linguistic_accuracy: 8, clarity_vocabulary: 8 },
    { task_completion: NaN, linguistic_accuracy: 8, clarity_vocabulary: 8 },
    null,
  ];
  for (const criteria of invalidRubrics) {
    const h = buildHarness({ released: true, aiAssessment: {
      criteria,
      general_comment: 'This writing can be evaluated.',
      corrected_text: 'I went to school and studied English.',
      explanations: ['Use past tense.'],
    } });
    const response = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
      submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'submitted');
    assert.equal(response.body.correction, 'retry');
    assert.equal(h.record.attempt.score, null);
    assert.equal(h.record.feedback.length, 0);
    assert.equal(h.calls.rpc.filter(call => call.name === 'homework_complete_writing').length, 0);
    assert.equal(h.calls.rpc.filter(call => call.name === 'homework_release_writing_lease').length, 1);
  }
});

test('Writing never persists more than twelve explanations including three rubric notes', async () => {
  const h = buildHarness({ released: true, aiAssessment: {
    criteria: { task_completion: 10, linguistic_accuracy: 10, clarity_vocabulary: 10 },
    general_comment: 'The writing achieves the expected learning outcomes.',
    corrected_text: 'I studied English yesterday.',
    explanations: Array.from({ length: 10 }, () => 'Explain grammar.'),
  } });
  const response = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(response.body.status, 'submitted');
  assert.equal(response.body.score, null);
  assert.equal(h.record.feedback.length, 0);
});


test('Writing processing lease does not consume quota or generate duplicate provider calls', async () => {
  const h = buildHarness({ released: true, claimStatus: 'processing' });
  const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'evaluating');
  assert.equal(h.calls.rpc.filter(call => call.name === 'homework_claim_writing').length, 1);
  assert.equal(h.calls.rpc.filter(call => call.name === 'consume_api_rate_limit').length, 0);
  assert.equal(h.calls.ai.length, 0);

  const complete = buildHarness({ released: true, claimStatus: 'evaluated' });
  const response = await complete.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(response.body.status, 'evaluated');
  assert.equal(complete.calls.rpc.filter(call =>
    call.name === 'consume_api_rate_limit').length, 0);
  assert.equal(complete.calls.ai.length, 0);
});

test('Writing quota exceeded releases lease and preserves the stored submission', async () => {
  const h = buildHarness({ released: true, rateLimit: false });
  const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(result.status, 429);
  assert.match(result.body.error, /Limite de correções atingido/);
  assert.equal(h.record.attempt.status, 'submitted');
  assert.equal(h.record.attempt.score, null);
  assert.equal(h.calls.rpc.filter(call => call.name === 'homework_claim_writing').length, 1);
  assert.equal(h.calls.rpc.filter(call => call.name === 'consume_api_rate_limit').length, 1);
  assert.equal(h.calls.rpc.filter(call =>
    call.name === 'homework_release_writing_lease').length, 1);
  assert.equal(h.calls.ai.length, 0);
});

test('Edge logs never expose raw backend error messages or submitted writing', async () => {
  const h = buildHarness({ released: true, rpcError: 'homework_submit' });
  const response = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(response.status, 500);
  assert.equal(response.body.error, 'Não foi possível acessar Tarefas para Casa.');
  assert.ok(h.calls.logs.some(value => value.includes('homework backend submit')));
  assert.doesNotMatch(h.calls.logs.join(' '), /private-student-mail|student submitted text/i);
  assert.doesNotMatch(h.calls.logs.join(' '), /I go to school and I study English/);

  const failing = buildHarness({ released: true, aiStatus: 503 });
  await failing.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.ok(failing.calls.logs.some(value => value.includes('provider_or_storage')));
  assert.doesNotMatch(failing.calls.logs.join(' '), /I go to school and I study English/);
});

test('monthly US$5 cap denies only the AI call, without discarding the submitted text', async () => {
  const h = buildHarness({ released: true, monthBudget: false });
  const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(result.status, 200);
  assert.equal(result.body.status, 'submitted');
  assert.equal(result.body.correction, 'monthly_budget');
  assert.match(result.body.message, /orçamento mensal/);
  assert.equal(result.body.score, null);
  assert.equal(h.record.attempt.status, 'submitted');
  assert.equal(h.calls.ai.length, 0);
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_ai_budget_reserve').length, 1);
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_ai_budget_settle').length, 0);
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_release_writing_lease').length, 1);
});

test('monthly budget is never reserved on concurrent or already evaluated Writing', async () => {
  for (const claimStatus of ['processing', 'evaluated']) {
    const h = buildHarness({ released: true, claimStatus });
    const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
      submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
    assert.equal(result.status, 200);
    assert.equal(h.calls.ai.length, 0);
    assert.equal(h.calls.rpc.filter(x => x.name === 'homework_ai_budget_reserve').length, 0);
  }
});

test('failed Writing assessment cannot invent token usage or release money prematurely', async () => {
  const h = buildHarness({ released: true, aiStatus: 503 });
  const response = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'I go to school and I study English.' } });
  assert.equal(response.body.status, 'submitted');
  assert.equal(response.body.correction, 'retry');
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_ai_budget_reserve').length, 1);
  assert.equal(h.calls.rpc.filter(x => x.name === 'homework_ai_budget_settle').length, 0);
  assert.equal(h.record.attempt.score, null);
});

test('unverified administrative age holds Writing without contacting the provider', async () => {
  for (const ageVerified of [false, null]) {
    const h = buildHarness({ released: true, ageVerified, dateOfBirth: '1980-05-05' });
    const sent = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
      submission_key: SUBMISSION, answers: { text: 'Yesterday I studied English.' } });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.correction, 'privacy_review');
    assert.equal(sent.body.status, 'submitted');
    assert.equal(sent.body.score, null);
    assert.equal(h.calls.ai.length, 0);
    assert.equal(h.calls.rpc.some(x => x.name === 'homework_claim_writing'), false);
    assert.equal(h.calls.rpc.some(x => x.name === 'homework_ai_budget_reserve'), false);
    const state = await h.request({ action: 'progress', assignment_id: ASSIGNMENT });
    assert.equal(state.body.correction, 'privacy_review');
    const retry = await h.request({ action: 'retry_correction', assignment_id: ASSIGNMENT });
    assert.equal(retry.body.correction, 'privacy_review');
    assert.equal(h.calls.ai.length, 0);
    assert.equal(JSON.stringify(retry.body).includes('date_of_birth'), false);
  }
});

test('adult Writing remains available and Reading is independent of the privacy gate', async () => {
  const h = buildHarness({ released: true, dateOfBirth: '1999-02-14', ageVerified: true });
  const result = await h.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { text: 'Yesterday I studied English.' } });
  assert.equal(result.body.status, 'evaluated');
  assert.equal(h.calls.ai.length, 1);
  const reading = buildHarness({ released: true, ageVerified: null, writing: false });
  const response = await reading.request({ action: 'submit', assignment_id: ASSIGNMENT,
    submission_key: SUBMISSION, answers: { answers: [] } });
  assert.equal(response.status, 200);
  assert.equal(reading.calls.ai.length, 0);
  assert.equal(reading.calls.tables.some(x =>
    x.name === 'homework_writing_age_verifications'), false);
});
