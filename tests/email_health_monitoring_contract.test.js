"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (filePath) => fs.readFileSync(path.join(root, filePath), "utf8");
const migration = read("supabase/migrations/20261015134000_integrate_email_notifications_with_system_health.sql");
const fixture = read("tests/sql/transactional_email_health_monitoring.sql");
const dashboard = read("system_health_dashboard.js");
const workflow = read(".github/workflows/validate-supabase-baseline.yml");

test("inspect three queues and existing retry job without duplicating scheduler", () => {
  for (const queue of [
    "enrollment_email_notifications",
    "makeup_class_email_notifications",
    "regular_lesson_cancellation_email_notifications",
  ]) {
    assert.ok(migration.includes("public." + queue));
  }
  assert.match(migration, /cron\.job_run_details/);
  assert.match(migration, /transactional-email-retry-10m/);
  assert.match(migration, /interval '20 minutes'/);
  assert.match(migration, /interval '18 hours'/);
  assert.match(migration, /attempts >= 3/);
  assert.doesNotMatch(migration, /cron\.(?:schedule|unschedule)\s*\(/);
  assert.doesNotMatch(migration, /net\.http_post|api\.resend\.com/i);
});

test("reuse canonical health runs and existing deduplicated alert pipeline", () => {
  assert.match(migration, /before insert on private\.system_health_runs/);
  assert.match(migration, /after insert on private\.system_health_runs/);
  assert.match(migration, /new\.metrics := new\.metrics/);
  assert.match(migration, /new\.issues := new\.issues/);
  assert.match(migration, /private\.enqueue_system_health_alert\(/);
  assert.match(migration, /current_setting\('app\.email_health_notify', true\)/);
  assert.match(migration, /set_config\('app\.email_health_notify'/);
  assert.match(migration, /if left\(issue_code, 6\) <> 'email_'/);
  assert.match(migration, /issue_code \|\| ':' \|\| issue_queue \|\| ':' \|\| bucket/);
});

test("keep private collectors inaccessible to browser roles", () => {
  for (const functionName of [
    "inspect_transactional_email_health",
    "attach_email_health_to_system_run",
    "enqueue_email_health_alerts_from_system_run",
  ]) {
    assert.match(
      migration,
      new RegExp("revoke all on function private\\." + functionName + "\\("),
    );
  }
  assert.match(migration, /security definer/g);
  assert.match(migration, /set search_path = ''/g);
  assert.doesNotMatch(migration, /student_name|student_email|recipientEmail|email_address/);
});

test("CI exercises real SQL behavior without sending webhook or keeping fixtures", () => {
  assert.match(workflow, /Exercise email health integration in disposable PostgreSQL/);
  assert.match(workflow, /DISABLE TRIGGER system_health_alert_dispatch/);
  assert.match(workflow, /tests\/sql\/transactional_email_health_monitoring\.sql/);
  assert.match(workflow, /echo 'BEGIN;'/);
  assert.match(workflow, /echo 'ROLLBACK;'/);
  assert.match(fixture, /target_notify=false/);
  assert.match(fixture, /deduplicate one hourly alert/);
});

test("admin dashboard recognizes all incident types", () => {
  for (const code of [
    "email_queue_delayed",
    "email_queue_retry_exhausted",
    "email_sent_timestamp_missing",
    "email_retry_cron_unhealthy",
    "email_retry_cron_execution_failed",
  ]) {
    assert.match(migration, new RegExp("'" + code + "'"));
    assert.match(dashboard, new RegExp(code + ":"));
  }
});
