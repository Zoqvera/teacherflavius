import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CURATED_LESSON_NUMBERS,
  CURATED_QUESTION_NUMBERS,
  createPublicSamples,
  servePublicSamples
} from "../supabase/functions/public-methodology-samples/samples_core.mjs";

const lesson = (number) => ({
  roadmap_lesson_number: number,
  title: "Lesson " + number,
  objective: "A learning objective",
  example: "A prepared example text",
  translation: "Uma tradução",
  practical_exercise: "Write your own presentation",
  useful_vocabulary: "Vocabulary list",
  created_by: "private user id",
  student_submission: "private student writing"
});

const question = (number) => ({
  display_order: number,
  question_text: "Question " + number + "?",
  question_translation: "Pergunta",
  student_id: "private student id",
  answer_examples: Array.from({ length: 5 }, (_, index) => ({
    answer: "Answer " + index,
    translation: "Resposta " + index,
    note: "Usage guidance " + index,
    private_metadata: "private"
  }))
});

test("explicit lesson and question allowlists are the only publication mechanism", () => {
  assert.deepEqual(CURATED_LESSON_NUMBERS, [1, 15, 30]);
  assert.equal(CURATED_QUESTION_NUMBERS.length, 12);
  const rows = [lesson(1), lesson(15), lesson(30), lesson(41)];
  const questions = [...CURATED_QUESTION_NUMBERS.map(question), question(154)];
  const result = createPublicSamples(rows, questions);

  assert.deepEqual(result.lessons.map(item => item.number), [1, 15, 30]);
  assert.deepEqual(result.questions.map(item => item.number), CURATED_QUESTION_NUMBERS);
  assert.equal(result.questions.every(item => item.examples.length === 2), true);
  assert.deepEqual(result.questions[0].examples.map(example => example.answer), [
    "Answer 0", "Answer 2"
  ]);

  const json = JSON.stringify(result);
  assert.equal(json.includes("private"), false);
  assert.equal(json.includes("Answer 1"), false);
  assert.equal(json.includes("Answer 3"), false);
  assert.equal(json.includes("Answer 4"), false);
  assert.equal(json.includes("student_id"), false);
  assert.equal(json.includes("created_by"), false);
});

test("supports deleted curated rows without filling them with unauthorized records", () => {
  const data = createPublicSamples([lesson(1), lesson(41)], [question(1), question(154)]);
  assert.deepEqual(data.lessons.map(item => item.number), [1]);
  assert.deepEqual(data.questions.map(item => item.number), [1]);
});

test("allows GET and HEAD and forbids write methods and unwanted origins", async () => {
  let calls = 0;
  const fetchSamples = async () => {
    calls += 1;
    return { lessons: [lesson(1)], questions: [question(1)] };
  };

  const getResponse = await servePublicSamples(new Request("https://example.test", {
    headers: { Origin: "https://teacherflavius.com" }
  }), fetchSamples);

  assert.equal(getResponse.status, 200);
  assert.equal(getResponse.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(getResponse.headers.get("Access-Control-Allow-Origin"), "https://teacherflavius.com");
  assert.equal((await getResponse.json()).lessons.length, 1);

  const headResponse = await servePublicSamples(new Request("https://example.test", {
    method: "HEAD"
  }), fetchSamples);
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), "");

  const deniedOrigin = await servePublicSamples(new Request("https://example.test", {
    headers: { Origin: "https://example.evil" }
  }), fetchSamples);
  assert.equal(deniedOrigin.status, 403);

  const forbiddenWrite = await servePublicSamples(new Request("https://example.test", {
    method: "POST"
  }), fetchSamples);
  assert.equal(forbiddenWrite.status, 405);
  assert.equal(calls, 2);
});

test("denies database errors without disclosure", async () => {
  const response = await servePublicSamples(new Request("https://example.test"), async () => {
    throw new Error("sensitive database details");
  });
  assert.equal(response.status, 503);
  assert.equal(JSON.stringify(await response.json()).includes("sensitive"), false);
});
