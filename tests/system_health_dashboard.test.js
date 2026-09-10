const test = require("node:test");
const assert = require("node:assert/strict");
const dashboard = require("../system_health_dashboard.js");

test("normalizes system health dashboard safely", function () {
  const normalized = dashboard.normalizeDashboard({
    generated_at: "2026-09-10T03:10:00Z",
    health: {
      status: "healthy",
      issue_count: 0,
      critical_count: 0,
      warning_count: 0,
      completed_at: "2026-09-10T03:09:59Z",
      metrics: { application_errors_15m: 2 },
      issues: []
    },
    probes: [{ target_key: "home", ok: true }],
    crons: [{ jobname: "system-synthetic-probe", stale: false }],
    alerts: []
  });

  assert.equal(normalized.health.status, "healthy");
  assert.equal(normalized.health.issueCount, 0);
  assert.equal(normalized.health.metrics.application_errors_15m, 2);
  assert.equal(normalized.probes.length, 1);
  assert.equal(normalized.crons.length, 1);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.health), true);
});

test("maps health and issue labels", function () {
  assert.equal(dashboard.healthLabel("healthy"), "SAUDÁVEL");
  assert.equal(dashboard.healthLabel("degraded"), "ATENÇÃO");
  assert.equal(dashboard.healthLabel("critical"), "CRÍTICO");
  assert.equal(dashboard.issueLabel("synthetic_availability_failure"), "Falha de disponibilidade sintética");
  assert.equal(dashboard.statusClass("failed"), "health-critical");
  assert.equal(dashboard.statusClass("sent"), "health-good");
});
