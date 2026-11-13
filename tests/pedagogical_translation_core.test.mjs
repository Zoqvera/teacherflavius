import test from "node:test";
import assert from "node:assert/strict";
import { MAX_SOURCE_CHARACTERS, validateRequest, validateResult } from "../pedagogical_translation/core.mjs";

test("valida texto e nível antes de solicitar a tradução", () => {
  assert.deepEqual(validateRequest("  Eu estudo inglês.  ", "A1"), { text: "Eu estudo inglês.", level: "A1" });
  assert.throws(() => validateRequest("  ", "A1"));
  assert.throws(() => validateRequest("x".repeat(MAX_SOURCE_CHARACTERS + 1), "A1"));
  assert.throws(() => validateRequest("Olá", "C1"));
});

test("aceita somente os campos pedagógicos esperados e rejeita resposta incompleta", () => {
  const result = validateResult({
    translation: "I study English.",
    expressions: [{ english: "study English", portuguese: "estudar inglês", extra: "ignorado" }],
    comparisons: [{ portuguese: "Eu estudo", english: "I study", explanation: "O pronome é expresso em inglês." }],
    practice: [{ prompt: "Diga o que você estuda.", example: "I study English." }],
    extra: "ignorado"
  });
  assert.equal(result.translation, "I study English.");
  assert.equal(result.expressions[0].extra, undefined);
  assert.equal(result.extra, undefined);
  assert.throws(() => validateResult({ translation: "Hello" }));
  assert.throws(() => validateResult({ ...result, practice: [] }));
});
