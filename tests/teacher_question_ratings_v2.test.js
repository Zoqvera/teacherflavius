const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (filename) => fs.readFileSync(path.join(ROOT, filename), "utf8");
const SOURCE = read("roteiro-da-aula-v2/question_ratings.js");
const APP = read("roteiro-da-aula-v2/app.js");
const PAGE = read("roteiro-da-aula-v2/index.html");
const OLD_PAGE = read("roteiro-da-aula-legado/index.html");
const MIGRATION = read("supabase/migrations/20261022202000_teacher_question_ratings_v2.sql");
const context = vm.createContext({ window: {} });
vm.runInContext(SOURCE, context);
const ratings = context.window.TeacherQuestionRatings;

const STUDENT_ID = "22222222-2222-4222-8222-222222222222";
const ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const QUESTION_ID = "33333333-3333-4333-8333-333333333333";
const OCCURRENCE_ID = "44444444-4444-4444-8444-444444444444";
const DATE = "2026-10-22";

function student(overrides = {}) {
  return Object.assign({
    student_id: STUDENT_ID,
    entry_id: ENTRY_ID,
    lesson_kind: "regular",
    starts_at: "2026-10-22T13:00:00Z",
    attendance_status: "scheduled",
    today_questions: [{ id: QUESTION_ID }],
    review_questions: []
  }, overrides);
}

function ack(rating = "good") {
  return {
    ok: true,
    rating,
    occurrence_id: OCCURRENCE_ID,
    attendance_status: "present",
    already_rated: false
  };
}

test("rating is allowed only on eligible questions of noncancelled students", () => {
  assert.equal(ratings.canRate(student(), DATE, QUESTION_ID, []), true);
  assert.equal(ratings.canRate(student({ attendance_status: "present" }), DATE, QUESTION_ID, []), true);
  assert.equal(ratings.canRate(student({ lesson_kind: "makeup" }), DATE, QUESTION_ID, []), true);
  assert.equal(ratings.canRate(student({ attendance_status: "cancelled" }), DATE, QUESTION_ID, []), false);
  assert.equal(ratings.canRate(student({ attendance_status: "absent" }), DATE, QUESTION_ID, []), false);
  assert.equal(ratings.canRate(student(), "2026-10-23", QUESTION_ID, []), false);
  assert.equal(ratings.canRate(student(), DATE, STUDENT_ID, []), false);
  assert.equal(ratings.canRate(student(), DATE, QUESTION_ID, [{
    question_id: QUESTION_ID, is_current: true, rating: "good"
  }]), false);
});

test("a review question is eligible and previously rated questions remain in history", () => {
  const reviewItem = student({
    today_questions: [],
    review_questions: [{ id: QUESTION_ID }]
  });
  const previous = [{ question_id: QUESTION_ID, rating: "medium", is_current: false }];
  assert.equal(ratings.canRate(reviewItem, DATE, QUESTION_ID, previous), true);
  assert.equal(ratings.ratingLabel("medium"), "MÉDIO");
  assert.equal(ratings.latestRating(previous, QUESTION_ID).rating, "medium");
  assert.equal(ratings.currentRating(previous, QUESTION_ID), null);
});

test("successful evaluation calls v2 RPC and requires confirmed attendance", async () => {
  const calls = [];
  const service = ratings.create({
    async rpc(name, params) {
      calls.push({ name, params });
      return { data: ack(), error: null };
    }
  });
  const result = await service.rate(student(), DATE, QUESTION_ID, "good", []);
  assert.equal(result.rating, "good");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, "rate_teacher_conversation_question_v2");
  assert.equal(calls[0].params.target_entry_id, ENTRY_ID);
  assert.equal(calls[0].params.target_question_id, QUESTION_ID);
});

test("rapid double-clicks on one question share a single server operation", async () => {
  let respond;
  let writes = 0;
  const response = new Promise((resolve) => { respond = resolve; });
  const service = ratings.create({
    rpc() { writes += 1; return response; }
  });
  const first = service.rate(student(), DATE, QUESTION_ID, "good", []);
  const second = service.rate(student(), DATE, QUESTION_ID, "good", []);
  assert.strictEqual(first, second);
  await Promise.resolve();
  assert.equal(writes, 1);
  respond({ data: ack(), error: null });
  await Promise.all([first, second]);
  await service.rate(student(), DATE, QUESTION_ID, "good", []);
  assert.equal(writes, 1);
});

test("failed rating does not cache success and can be attempted again", async () => {
  let attempts = 0;
  const service = ratings.create({
    async rpc() {
      attempts += 1;
      if (attempts === 1) return { data: null, error: new Error("Falha de rede") };
      return { data: ack("improve"), error: null };
    }
  });
  await assert.rejects(service.rate(student(), DATE, QUESTION_ID, "improve", []), /Falha de rede/);
  const result = await service.rate(student(), DATE, QUESTION_ID, "improve", []);
  assert.equal(result.rating, "improve");
  assert.equal(attempts, 2);
});

test("missing or invalid server acknowledgement never records a rating as confirmed", async () => {
  const invalid = [null, { ok: false }, { ok: true, rating: "good" },
    { ok: true, rating: "unknown", occurrence_id: OCCURRENCE_ID, attendance_status: "present" }];
  for (const reply of invalid) {
    const service = ratings.create({ rpc: async () => ({ data: reply, error: null }) });
    await assert.rejects(service.rate(student(), DATE, QUESTION_ID, "good", []),
      /servidor não confirmou/i);
  }
});

test("history RPC is scoped by date and current-lesson ratings are distinct", async () => {
  const rows = [{
    student_id: STUDENT_ID,
    starts_at: "2026-10-22T13:00:00Z",
    evaluations: [
      { question_id: QUESTION_ID, rating: "good", is_current: true },
      { question_id: QUESTION_ID, rating: "medium", is_current: false }
    ]
  }];
  const service = ratings.create({
    async rpc(name, args) {
      assert.equal(name, "get_teacher_question_rating_history_v2");
      assert.equal(args.target_date, DATE);
      return { data: rows, error: null };
    }
  });
  const history = await service.getHistory(DATE);
  assert.equal(history.available, true);
  const entry = history.byOccurrence.get(STUDENT_ID + "|" + rows[0].starts_at);
  assert.equal(entry.length, 2);
  assert.equal(ratings.currentRating(entry, QUESTION_ID).rating, "good");
  assert.equal(ratings.latestRating(entry, QUESTION_ID).rating, "good");
});

test("preview gracefully handles history RPC pending deployment", async () => {
  const service = ratings.create({
    rpc: async () => ({ data: null, error: { code: "PGRST202" } })
  });
  const history = await service.getHistory(DATE);
  assert.equal(history.available, false);
  assert.equal(history.byOccurrence.size, 0);
});

test("SQL provides teacher-only additive RPCs and preserves historic per-lesson assessments", () => {
  assert.match(MIGRATION, /create or replace function public\.rate_teacher_conversation_question_v2/i);
  assert.match(MIGRATION, /create or replace function public\.get_teacher_question_rating_history_v2/i);
  assert.match(MIGRATION, /auth\.uid\(\) is null or not coalesce\(public\.is_teacher_admin\(\), false\)/i);
  assert.match(MIGRATION, /private\.sync_academic_attendance\(/i);
  assert.match(MIGRATION, /public\.rate_teacher_conversation_question\(/i);
  assert.match(MIGRATION, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(MIGRATION, /from private\.conversation_question_practice_log practice/i);
  assert.match(MIGRATION, /from public\.get_teacher_lesson_plan\(effective_date\)/i);
  assert.match(MIGRATION, /occurrence\.starts_at <= roster\.starts_at/i);
  assert.match(MIGRATION, /revoke all on function public\.rate_teacher_conversation_question_v2[\s\S]*from public, anon/i);
  assert.match(MIGRATION, /revoke all on function public\.get_teacher_question_rating_history_v2\(date\)[\s\S]*from public, anon/i);
  assert.doesNotMatch(MIGRATION, /create or replace function public\.rate_teacher_conversation_question\s*\(/i);
  assert.doesNotMatch(MIGRATION, /(?:delete|truncate)\s+(?:from\s+)?private\.conversation_question_practice_log/i);
});

test("v2 teacher ratings enabled while existing route remains untouched", () => {
  assert.match(APP, /const QUESTION_RATINGS_ENABLED = true/);
  assert.match(APP, /state\.questionRatings\.rate\(/);
  assert.match(APP, /rateQuestion\(item, question, rating, control\)/);
  assert.match(APP, /"TODAS AS PERGUNTAS ESTUDADAS"/);
  assert.match(APP, /"PERGUNTAS A SEREM REVISADAS"/);
  assert.match(APP, /"PERGUNTAS ESTUDADAS PARA HOJE"/);
  assert.match(PAGE, /question_ratings\.js\?v=20261022-etapa3/);
  assert.match(PAGE, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(OLD_PAGE, /src="\/roteiro-da-aula\/app\.js/);
  assert.doesNotMatch(OLD_PAGE, /roteiro-da-aula-v2/);
  assert.doesNotMatch(SOURCE + APP + PAGE, /\bonline\b/i);
});
