import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestBody, parseResponse, runSmoke, MODEL } from '../scripts/homework_stage5_provider_smoke.mjs';

function responseWithCriteria(criteria, extras = {}) {
  return {
    status: 'completed',
    output: [{
      content: [{
        type: 'output_text',
        text: JSON.stringify({
          criteria,
          general_comment: 'A resposta atende parcialmente ao enunciado.',
          corrected_text: 'Yesterday I went to school and met a friend.',
          explanations: ['Use o passado em verbos que descrevem ontem.'],
          ...extras,
        }),
      }],
    }],
  };
}

test('smoke payload mirrors the released GPT-6 Luna strict schema and sends synthetic writing', () => {
  const body = requestBody();
  assert.equal(MODEL, 'gpt-6-luna');
  assert.equal(body.model, MODEL);
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'none');
  assert.equal(body.max_output_tokens, 1400);
  assert.equal(body.text.format.name, 'writing_assessment');
  assert.equal(body.text.format.strict, true);
  assert.deepEqual(body.text.format.schema.required,
    ['criteria', 'general_comment', 'corrected_text', 'explanations']);
  assert.deepEqual(body.text.format.schema.properties.criteria.required,
    ['task_completion', 'linguistic_accuracy', 'clarity_vocabulary']);
  assert.equal(body.input[1].role, 'user');
  assert.ok(!JSON.stringify(body).includes('teacherflavius.com'));

  // Keep the external smoke aligned with the deployed Edge implementation.
  const edge = readFileSync('supabase/functions/homework-student/index.ts', 'utf8');
  assert.match(edge, /const MODEL = "gpt-6-luna"/);
  assert.match(edge, /name: "writing_assessment", strict: true/);
  assert.match(edge, /criteria.task_completion \* 0\.4/);
  assert.match(edge, /criteria.linguistic_accuracy \* 0\.3/);
  assert.match(edge, /criteria.clarity_vocabulary \* 0\.3/);
  assert.match(edge, /max_output_tokens: 1400/);
});

test('real-provider smoke score is weighted from three validated grades', () => {
  const result = parseResponse(responseWithCriteria({
    task_completion: 8, linguistic_accuracy: 6, clarity_vocabulary: 9,
  }));
  assert.equal(result.score, 7.7);
});

test('smoke rejects incomplete grades and malformed feedback', () => {
  const criteria = { task_completion: 10, linguistic_accuracy: 8, clarity_vocabulary: 7 };
  for (const invalid of [
    { ...criteria, task_completion: -1 },
    { ...criteria, clarity_vocabulary: 11 },
    { ...criteria, linguistic_accuracy: '8' },
    { ...criteria, clarity_vocabulary: null },
    {},
  ]) {
    assert.throws(() => parseResponse(responseWithCriteria(invalid)), /rubric/);
  }
  assert.throws(() => parseResponse({ status: 'incomplete', output: [] }),
    /did not complete/);
  assert.throws(() => parseResponse(responseWithCriteria(criteria, {
    corrected_text: '', explanations: [],
  })), /rubric/);
  assert.throws(() => parseResponse(responseWithCriteria(criteria, {
    explanations: Array.from({ length: 10 }, () => 'Too many'),
  })), /rubric/);
});

test('one-call provider success reveals only numeric rubric diagnostics', async () => {
  let invoked = 0;
  const result = await runSmoke({
    apiKey: 'sk-test-fake-never-real',
    fetchImpl: async (url, options) => {
      invoked++;
      assert.equal(url, 'https://api.openai.com/v1/responses');
      assert.equal(options.headers.Authorization, 'Bearer sk-test-fake-never-real');
      assert.equal(options.signal.aborted, false);
      return {
        ok: true,
        json: async () => responseWithCriteria({
          task_completion: 8, linguistic_accuracy: 6, clarity_vocabulary: 9,
        }),
      };
    },
  });
  assert.equal(invoked, 1);
  assert.equal(result.result, 'PASS');
  assert.equal(result.score, 7.7);
  assert.equal(result.synthetic_only, true);
  assert.equal(result.response_storage_opt_out, true);
  assert.equal(JSON.stringify(result).includes('sk-test-fake'), false);
});

test('no API request without key, and external errors never print response bodies', async () => {
  await assert.rejects(() => runSmoke({ apiKey: '', fetchImpl: () => {
    throw new Error('fetch must not be called');
  } }), /OPENAI_API_KEY/);
  let called = 0;
  await assert.rejects(() => runSmoke({
    apiKey: 'sk-test-fake-never-real',
    fetchImpl: async () => {
      called++;
      return { ok: false, status: 401, text: async () => 'secret error details' };
    },
  }), error => {
    assert.equal(error.message, 'OpenAI provider returned HTTP 401.');
    assert.equal(error.message.includes('secret error details'), false);
    return true;
  });
  assert.equal(called, 1);
});
