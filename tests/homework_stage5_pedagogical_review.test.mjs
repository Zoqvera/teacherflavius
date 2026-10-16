import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REVIEW_CASES, runPedagogicalReview } from '../scripts/homework_stage5_pedagogical_review.mjs';
import { requestBody } from '../scripts/homework_stage5_provider_smoke.mjs';

function mockedProvider() {
  let calls = 0;
  const inputs = [];
  return {
    get calls() { return calls; },
    inputs,
    async fetch(url, options) {
      calls += 1;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer sk-synthetic-test-key');
      const payload = JSON.parse(options.body);
      assert.equal(payload.model, 'gpt-6-luna');
      assert.equal(payload.store, false);
      assert.equal(payload.service_tier, 'default');
      assert.equal(payload.max_output_tokens, 1400);
      assert.equal(payload.text.format.strict, true);
      const input = JSON.parse(payload.input[1].content);
      inputs.push(input);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            status: 'completed',
            output: [{
              content: [{
                type: 'output_text',
                text: JSON.stringify({
                  criteria: {
                    task_completion: 8, linguistic_accuracy: 6,
                    clarity_vocabulary: 9,
                  },
                  general_comment: 'Seu texto foi avaliado conforme o enunciado.',
                  corrected_text: input.texto_do_estudante,
                  explanations: ['Avaliação realizada respeitando a rubrica.'],
                }),
              }],
            }],
          };
        },
      };
    },
  };
}

test('off-topic synthetic case remains factually unchanged when grammatical', () => {
  const sample = REVIEW_CASES.find(item => item.id === 'a2-off-topic');
  assert.equal(sample.text, 'My school is big and beautiful. I like my teacher. There are many rooms.');
  assert.match(sample.focus, /does not describe yesterday/);
  const prompt = requestBody(sample).input[0].content;
  assert.match(prompt, /não invente/);
});

test('five immutable synthetic cases cover the intended A1/A2 risks', () => {
  assert.equal(REVIEW_CASES.length, 5);
  assert.equal(new Set(REVIEW_CASES.map(sample => sample.id)).size, 5);
  for (const sample of REVIEW_CASES) {
    assert.ok(['A1', 'A2'].includes(sample.level));
    assert.ok(sample.prompt.length > 15);
    assert.ok(sample.text.length > 20);
    assert.ok(sample.focus.length > 15);
    assert.equal(requestBody(sample).store, false);
  }
  assert.match(REVIEW_CASES.at(-1).text, /Ignore all criteria/);
});

test('manual review makes exactly five calls, not logged, with editable result artifact', async () => {
  const mock = mockedProvider();
  const report = await runPedagogicalReview({
    apiKey: 'sk-synthetic-test-key', fetchImpl: mock.fetch.bind(mock),
  });
  assert.equal(mock.calls, 5);
  assert.equal(report.results.length, 5);
  assert.equal(report.status, 'TEACHER_ACCEPTANCE_PENDING');
  assert.equal(report.production_budget_charged, false);
  assert.equal(JSON.stringify(report).includes('sk-synthetic-test-key'), false);
  for (let i = 0; i < 5; i++) {
    assert.equal(report.results[i].student_text, REVIEW_CASES[i].text);
    assert.equal(report.results[i].score, 7.7);
    assert.equal(report.results[i].criteria.task_completion, 8);
    assert.equal(mock.inputs[i].enunciado, REVIEW_CASES[i].prompt);
    assert.equal(mock.inputs[i].texto_do_estudante, REVIEW_CASES[i].text);
  }
});

test('unconfigured key is rejected without any external request', async () => {
  let calls = 0;
  await assert.rejects(runPedagogicalReview({
    apiKey: '', fetchImpl: async () => { calls++; },
  }), /OPENAI_API_KEY/);
  assert.equal(calls, 0);
});

test('failed provider never prints response bodies and stops further paid calls', async () => {
  const mock = mockedProvider();
  let calls = 0;
  await assert.rejects(runPedagogicalReview({
    apiKey: 'sk-synthetic-test-key',
    fetchImpl: async (url, options) => {
      calls++;
      if (calls === 2) return { ok: false, status: 503,
        json: async () => { throw Error('confidential input'); } };
      return mock.fetch(url, options);
    },
  }), error => {
    assert.match(error.message, /HTTP 503/);
    assert.doesNotMatch(error.message, /confidential input/);
    return true;
  });
  assert.equal(calls, 2);
});

test('manual-review workflow cannot issue billable requests on pull requests', () => {
  const yaml = readFileSync('.github/workflows/homeworks-writing-provider-smoke.yml', 'utf8');
  assert.match(yaml, /github\.event_name == 'workflow_dispatch'/);
  assert.match(yaml, /inputs\.pedagogical_review/);
  assert.match(yaml, /retention-days: 7/);
  assert.match(yaml, /upload-artifact@v4/);
  assert.ok(yaml.includes("if: ${{ github.event_name == 'workflow_dispatch' && inputs.pedagogical_review }}"));
  assert.ok(yaml.includes("if: ${{ github.event_name == 'workflow_dispatch' && !inputs.pedagogical_review }}"));
});
