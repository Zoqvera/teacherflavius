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
    data_quality: {
      status: "degraded",
      issue_count: 1,
      critical_count: 0,
      warning_count: 1,
      completed_at: "2026-09-10T03:09:30Z",
      metrics: { student_class_type_mismatch: 1 },
      issues: [{
        code: "data_quality_student_class_type_mismatch",
        severity: "warning",
        details: { count: 1 }
      }]
    },
    auth_health: {
      status: "healthy",
      issue_count: 0,
      critical_count: 0,
      warning_count: 0,
      completed_at: "2026-09-10T03:09:40Z",
      metrics: { mapped_admin_without_verified_mfa: 0 },
      issues: []
    },
    probes: [{ target_key: "home", ok: true }],
    crons: [{ jobname: "system-synthetic-probe", stale: false }],
    alerts: []
  });

  assert.equal(normalized.health.status, "healthy");
  assert.equal(normalized.health.issueCount, 0);
  assert.equal(normalized.health.metrics.application_errors_15m, 2);
  assert.equal(normalized.dataQuality.status, "degraded");
  assert.equal(normalized.dataQuality.issueCount, 1);
  assert.equal(normalized.dataQuality.metrics.student_class_type_mismatch, 1);
  assert.equal(normalized.authHealth.status, "healthy");
  assert.equal(normalized.authHealth.issueCount, 0);
  assert.equal(normalized.authHealth.metrics.mapped_admin_without_verified_mfa, 0);
  assert.equal(normalized.probes.length, 1);
  assert.equal(normalized.crons.length, 1);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.health), true);
  assert.equal(Object.isFrozen(normalized.dataQuality), true);
  assert.equal(Object.isFrozen(normalized.authHealth), true);
});

test("normalizes missing specialized health states without throwing", function () {
  const normalized = dashboard.normalizeDashboard({ health: { status: "healthy" } });
  assert.equal(normalized.dataQuality.status, "unknown");
  assert.equal(normalized.dataQuality.issueCount, 0);
  assert.deepEqual(normalized.dataQuality.issues, []);
  assert.equal(normalized.authHealth.status, "unknown");
  assert.equal(normalized.authHealth.issueCount, 0);
  assert.deepEqual(normalized.authHealth.issues, []);
});

test("maps health and issue labels", function () {
  assert.equal(dashboard.healthLabel("healthy"), "SAUDÁVEL");
  assert.equal(dashboard.healthLabel("degraded"), "ATENÇÃO");
  assert.equal(dashboard.healthLabel("critical"), "CRÍTICO");
  assert.equal(dashboard.issueLabel("synthetic_availability_failure"), "Falha de disponibilidade sintética");
  assert.equal(
    dashboard.issueLabel("data_quality_student_class_type_mismatch"),
    "Tipo do aluno incompatível com a turma"
  );
  assert.equal(
    dashboard.issueLabel("auth_admin_without_verified_mfa"),
    "Administrador sem MFA verificado"
  );
  assert.equal(dashboard.statusClass("failed"), "health-critical");
  assert.equal(dashboard.statusClass("sent"), "health-good");
});
