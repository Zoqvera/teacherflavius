import assert from "node:assert/strict";
import { test } from "node:test";
import { loadPublicSamples, validatePublicSamples } from "../metodologia-e-conteudo-programatico/samples_service.mjs";

function lesson(number) { return { number, title: "Lição", example: "Texto" }; }
function question(number) {
  return { number, question: "How are you?", examples: [
    { answer: "First" }, { answer: "Second" }, { answer: "Third" }
  ] };
}

test("filters to approved demonstrations", () => {
  const actual = validatePublicSamples({
    lessons: [lesson(1), lesson(15), lesson(30), lesson(41)],
    questions: [question(1), question(4), question(154)]
  });
  assert.deepEqual(actual.lessons.map(item => item.number), [1, 15, 30]);
  assert.deepEqual(actual.questions.map(item => item.number), [1, 4]);
  assert.equal(actual.questions[0].examples.length, 2);
});

test("rejects duplicates or invalid shape", () => {
  assert.throws(() => validatePublicSamples({ lessons: [], questions: [] }));
  assert.throws(() => validatePublicSamples({ lessons: [lesson(1), lesson(1)], questions: [question(1)] }));
});

test("fetches samples with cache disabled", async () => {
  let options;
  const data = await loadPublicSamples(async (_, input) => {
    options = input;
    return { ok: true, json: async () => ({ lessons: [lesson(1)], questions: [question(1)] }) };
  });
  assert.equal(data.lessons.length, 1);
  assert.equal(options.cache, "no-store");
});
