"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const historyPage = fs.readFileSync(
  path.join(root, "conversation-questions/estudadas/index.html"), "utf8"
);
const historyScript = fs.readFileSync(
  path.join(root, "conversation-questions/estudadas/history.js"), "utf8"
);
const secondPart = fs.readFileSync(
  path.join(root, "o-que-fazer/segunda-parte/index.html"), "utf8"
);
const service = fs.readFileSync(path.join(root, "academic_workflow_service.js"), "utf8");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261022013500_get_my_studied_questions.sql"),
  "utf8"
);

function node(tag = "div") {
  return {
    tagName: tag,
    children: [],
    dataset: {},
    hidden: false,
    _text: "",
    get textContent() { return this._text; },
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    },
    appendChild(child) { this.children.push(child); }
  };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function openHistory({ records = [], active = true, authenticated = true, failure = null } = {}) {
  const nodes = new Map();
  const calls = { history: 0, redirects: [] };
  const document = {
    readyState: "complete",
    body: { classList: { remove() {} } },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, node());
      return nodes.get(id);
    },
    createElement: node
  };
  const window = {
    location: { replace(url) { calls.redirects.push(url); } },
    Auth: {
      isConfigured: () => true,
      getSession: async () => authenticated ? { user: { id: "student-1" } } : null,
      getClient: () => ({})
    },
    ResourceWaiter: { waitUntil: async (predicate) => predicate() },
    AcademicWorkflowService: {
      create() {
        return {
          isActiveStudent: async () => active,
          getMyStudiedQuestions: async () => {
            calls.history += 1;
            if (failure) throw failure;
            return records;
          }
        };
      }
    },
    ConversationQuestionCardRenderer: {
      create(question, options) {
        const card = node("article");
        card.questionId = question.id;
        card.number = options.number;
        return card;
      }
    }
  };

  vm.runInNewContext(historyScript, { window, document, console: { error() {} } }, {
    filename: "conversation-questions/estudadas/history.js"
  });
  await flush();
  return { calls, get: document.getElementById.bind(document) };
}

test("second-part navigation leads to private history and catalog remains the full catalog", () => {
  assert.match(secondPart, /href="\/conversation-questions\/estudadas\/">PERGUNTAS JÁ ESTUDADAS<\/a>/);
  assert.match(historyPage, /href="\/conversation-questions\/">TODAS AS PERGUNTAS<\/a>/);
  assert.match(historyPage, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(historyPage, /academic_workflow_service\.js\?v=20261022-study-history-1/);
  assert.match(historyPage, /history\.js\?v=20261022-study-history-1/);
  assert.doesNotMatch(historyPage, /\bonline\b/i);
});

test("RPC is read only, preserves original click timestamps, and scopes results to active auth user", () => {
  assert.match(migration, /public\.get_my_studied_questions\(\)/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/i);
  assert.match(migration, /caller_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(migration, /profile\.enrolled is true[\s\S]*profile\.archived is false/);
  assert.match(migration, /study\.student_id = caller_id/);
  assert.match(migration, /study\.studied_at/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated, service_role/);
  assert.doesNotMatch(migration, /\b(insert|update|delete)\s+(into|from|private\.)/i);
  assert.match(service, /async function getMyStudiedQuestions\(\)/);
  assert.match(service, /supabase\.rpc\("get_my_studied_questions"\)/);
});

test("first-study dates group by Sao Paulo day, latest first, preserving catalog numbering", async () => {
  const view = await openHistory({
    records: [
      { id: "old", display_order: 3, studied_at: "2026-10-21T02:00:00Z" },
      { id: "latest", display_order: 12, studied_at: "2026-10-22T00:45:00Z" },
      { id: "earlier", display_order: 7, studied_at: "2026-10-21T23:00:00Z" }
    ]
  });
  assert.equal(view.calls.history, 1);
  assert.equal(view.get("studiedQuestionCount").textContent, "3");
  assert.equal(view.get("studiedDayCount").textContent, "2");
  const groups = view.get("studiedQuestionGroups").children;
  assert.equal(groups.length, 2);
  assert.match(groups[0].children[0].textContent, /^21\/10\/2026 — 2 perguntas$/);
  assert.match(groups[1].children[0].textContent, /^20\/10\/2026 — 1 pergunta$/);
  const firstDayEntries = groups[0].children[1].children;
  assert.equal(firstDayEntries[0].children[0].questionId, "latest");
  assert.equal(firstDayEntries[0].children[0].number, 12);
  assert.equal(firstDayEntries[1].children[0].questionId, "earlier");
  assert.equal(firstDayEntries[1].children[0].number, 7);
});

test("unknown historical date remains available without inventing a day", async () => {
  const view = await openHistory({
    records: [{ id: "legacy", display_order: 19, studied_at: null }]
  });
  assert.equal(view.get("studiedQuestionCount").textContent, "1");
  assert.equal(view.get("studiedDayCount").textContent, "0");
  assert.match(view.get("studiedQuestionGroups").children[0].children[0].textContent,
    /Data de estudo não registrada/);
});

test("empty history, inactive student, and unauthenticated access stay safe", async () => {
  const empty = await openHistory();
  assert.match(empty.get("studiedQuestionGroups").children[0].textContent, /ainda não marcou/);
  const inactive = await openHistory({ active: false });
  assert.equal(inactive.calls.history, 0);
  assert.match(inactive.get("studiedQuestionsStatus").textContent, /apenas para alunos ativos/);
  const signedOut = await openHistory({ authenticated: false });
  assert.equal(signedOut.calls.history, 0);
  assert.match(signedOut.calls.redirects[0], /\/login\/\?next=/);
});

test("load failure never renders another student's information", async () => {
  const view = await openHistory({ failure: new Error("database unavailable") });
  assert.equal(view.get("studiedQuestionGroups").children.length, 0);
  assert.match(view.get("studiedQuestionsStatus").textContent, /Não foi possível carregar/);
});
