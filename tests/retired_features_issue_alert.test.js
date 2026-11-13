"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  ALERT_MARKER,
  ALERT_TITLE,
  findOpenIncident,
  synchronizeMonitorIssue,
} = require("../scripts/retired_features_issue_alert");

const RUN_URL = "https://github.com/Zoqvera/teacherflavius/actions/runs/12345";
const CONTEXT = { owner: "Zoqvera", repo: "teacherflavius", runUrl: RUN_URL };

function fakeGithub(issues = []) {
  const calls = [];
  const github = {
    paginate: async (_fn, args) => {
      calls.push(["list", args]);
      return issues;
    },
    rest: {
      issues: {
        listForRepo() {},
        create: async args => calls.push(["create", args]),
        createComment: async args => calls.push(["comment", args]),
        update: async args => calls.push(["update", args]),
      },
    },
  };
  return { github, calls };
}

function existingIncident(number = 17) {
  return { number, title: ALERT_TITLE, body: ALERT_MARKER };
}

test("opens one actionable incident on a detected production regression", async () => {
  const { github, calls } = fakeGithub();
  const outcome = await synchronizeMonitorIssue({ github, ...CONTEXT, outcome: "failure" });
  assert.equal(outcome, "opened");
  assert.deepEqual(calls.map(([name]) => name), ["list", "create"]);
  assert.equal(calls[0][1].state, "open");
  assert.match(calls[1][1].body, /Minha Semana, Planos Semanais/);
  assert.ok(calls[1][1].body.includes(RUN_URL));
  assert.ok(calls[1][1].body.includes(ALERT_MARKER));
});

test("does not create duplicate alerts while an incident remains open", async () => {
  const { github, calls } = fakeGithub([existingIncident()]);
  const outcome = await synchronizeMonitorIssue({ github, ...CONTEXT, outcome: "failure" });
  assert.equal(outcome, "already-open");
  assert.deepEqual(calls.map(([name]) => name), ["list"]);
});

test("only matches monitor-created issues, never pull requests or unrelated issues", () => {
  assert.equal(findOpenIncident([
    { ...existingIncident(18), pull_request: { url: "https://api.github.com/pr" } },
    { number: 19, title: ALERT_TITLE, body: "Outro chamado manual" },
  ]), undefined);
});

test("successful audit closes a prior incident with a recovery audit trail", async () => {
  const { github, calls } = fakeGithub([existingIncident(42)]);
  const outcome = await synchronizeMonitorIssue({ github, ...CONTEXT, outcome: "success" });
  assert.equal(outcome, "resolved");
  assert.deepEqual(calls.map(([name]) => name), ["list", "comment", "update"]);
  assert.equal(calls[1][1].issue_number, 42);
  assert.equal(calls[2][1].state, "closed");
  assert.equal(calls[2][1].state_reason, "completed");
  assert.ok(calls[1][1].body.includes(RUN_URL));
});

test("healthy audit leaves the issue tracker unchanged", async () => {
  const { github, calls } = fakeGithub();
  const outcome = await synchronizeMonitorIssue({ github, ...CONTEXT, outcome: "success" });
  assert.equal(outcome, "healthy");
  assert.deepEqual(calls.map(([name]) => name), ["list"]);
});

test("incomplete audit outcomes cannot accidentally open or close incidents", async () => {
  const { github, calls } = fakeGithub([existingIncident()]);
  await assert.rejects(
    () => synchronizeMonitorIssue({ github, ...CONTEXT, outcome: "skipped" }),
    /Resultado de auditoria inválido/,
  );
  assert.equal(calls.length, 0);
});

test("untrusted execution links do not enter incident bodies", async () => {
  const { github, calls } = fakeGithub();
  await assert.rejects(
    () => synchronizeMonitorIssue({
      github, ...CONTEXT, outcome: "failure", runUrl: "https://example.com/untrusted",
    }),
    /Contexto da execução inválido/,
  );
  assert.equal(calls.length, 0);
});

test("workflow keeps issue-write access isolated from pull-request checks", () => {
  const workflow = fs.readFileSync(
    path.resolve(__dirname, "../.github/workflows/suspended-exercise-portal-monitor.yml"),
    "utf8",
  );
  const [auditJob, alertJob] = workflow.split("  notify-regressions:");

  assert.match(auditJob, /production_audit_outcome:/);
  assert.doesNotMatch(auditJob, /issues: write/);
  assert.match(alertJob, /needs: suspended-portal/);
  assert.match(alertJob, /github\.event_name == 'schedule'/);
  assert.match(alertJob, /github\.event_name == 'workflow_dispatch'/);
  assert.match(alertJob, /github\.ref == 'refs\/heads\/main'/);
  assert.match(alertJob, /issues: write/);
  assert.match(alertJob, /actions\/github-script@v9/);
  assert.match(alertJob, /needs\.suspended-portal\.outputs\.production_audit_outcome/);
});
