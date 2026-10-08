"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const dashboardSource = fs.readFileSync(path.join(ROOT, "minha_semana_dashboard.js"), "utf8");
const weeklyPage = fs.readFileSync(path.join(ROOT, "minha-semana/index.html"), "utf8");

async function renderWeeklyRoadmap(actionPlan, actionPlanError = null) {
  const elements = new Map();
  const queriedTables = [];
  const calledRpcs = [];

  function getElementById(id) {
    if (!elements.has(id)) {
      elements.set(id, {
        textContent: "",
        innerHTML: "",
        className: "",
        hidden: id === "dashboard",
        style: {}
      });
    }
    return elements.get(id);
  }

  const tableRows = {
    profiles: [{ id: "student-1", name: "Aluno Teste", enrolled: true, archived: false }],
    class_students: []
  };

  function createQuery(table) {
    const query = {
      select() { return this; },
      eq() { return this; },
      gte() { return this; },
      lte() { return this; },
      order() { return this; },
      limit() { return this; },
      then(resolve, reject) {
        return Promise.resolve({ data: tableRows[table] || [], error: null }).then(resolve, reject);
      }
    };
    return query;
  }

  const client = {
    from(table) {
      queriedTables.push(table);
      return createQuery(table);
    },
    async rpc(name) {
      calledRpcs.push(name);
      if (name === "ensure_weekly_plan_snapshot") {
        return {
          data: [{
            week_number: 25,
            week_start: "2026-10-05",
            week_end: "2026-10-11"
          }],
          error: null
        };
      }
      if (name === "get_public_teacher_exercises") {
        return { data: [], error: null };
      }
      if (name === "get_my_action_plan") {
        return { data: actionPlan, error: actionPlanError };
      }
      throw new Error("RPC inesperada: " + name);
    }
  };

  const auth = {
    isConfigured() { return true; },
    async getSession() { return { user: { id: "student-1" } }; },
    getClient() { return client; }
  };
  const document = {
    getElementById,
    body: { classList: { remove() {} } }
  };
  const window = { Auth: auth, SUPABASE_CONFIG: {}, location: { href: "" } };

  vm.runInNewContext(dashboardSource, {
    document,
    window,
    Auth: auth,
    console
  }, { filename: "minha_semana_dashboard.js" });

  await new Promise(function (resolve) { setImmediate(resolve); });

  return {
    roadmapHtml: getElementById("roadmapPanel").innerHTML,
    loadingMessage: getElementById("loadingPanel").textContent,
    dashboardVisible: getElementById("dashboard").hidden === false,
    queriedTables,
    calledRpcs
  };
}

test("Minha Semana uses the canonical action plan instead of a fixed 24-lesson calculation", async function () {
  const state = await renderWeeklyRoadmap({ lesson: { number: 25 } });

  assert.equal(state.dashboardVisible, true);
  assert.match(state.roadmapHtml, /Próxima lição: Lição 25/);
  assert.deepEqual(state.calledRpcs.filter(function (rpc) {
    return rpc === "get_my_action_plan";
  }), ["get_my_action_plan"]);
  assert.equal(state.queriedTables.includes("study_roadmap_completion"), false);
  assert.doesNotMatch(dashboardSource, /ROADMAP_TOTAL/);
});

test("Minha Semana handles lesson 74 and future catalog extensions without a client-side ceiling", async function () {
  for (const lessonNumber of [74, 75]) {
    const state = await renderWeeklyRoadmap({ lesson: { number: lessonNumber } });
    assert.equal(state.dashboardVisible, true);
    assert.match(state.roadmapHtml, new RegExp("Próxima lição: Lição " + lessonNumber));
    assert.doesNotMatch(state.roadmapHtml, /Roteiro concluído/);
  }
});

test("Minha Semana only marks the roadmap complete when the action plan returns no lesson", async function () {
  const state = await renderWeeklyRoadmap({ lesson: null });

  assert.equal(state.dashboardVisible, true);
  assert.match(state.roadmapHtml, /Roteiro concluído/);
});

test("Minha Semana never confuses an action plan failure with course completion", async function () {
  for (const [plan, error] of [
    [{}, null],
    [null, null],
    [null, { message: "Falha ao consultar a progressão acadêmica" }]
  ]) {
    const state = await renderWeeklyRoadmap(plan, error);

    assert.equal(state.dashboardVisible, false);
    assert.match(state.loadingMessage, /Não foi possível montar sua semana/);
    assert.doesNotMatch(state.roadmapHtml, /Roteiro concluído/);
  }
});

test("Minha Semana refreshes its dashboard script without altering the canonical URL", function () {
  assert.match(weeklyPage, /<link rel="canonical" href="\/minha-semana\/">/);
  assert.match(weeklyPage, /\/minha_semana_dashboard\.js\?v=20261008-1/);
});
