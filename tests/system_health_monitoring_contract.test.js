const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20260910030206_add_global_system_health_monitoring.sql"), "utf8");
const bootstrapFix = fs.readFileSync(path.join(root, "supabase/migrations/20260910030731_prevent_system_health_bootstrap_false_alert.sql"), "utf8");
const syntheticProbe = fs.readFileSync(path.join(root, "supabase/functions/system-synthetic-probe/index.ts"), "utf8");
const dashboardFunction = fs.readFileSync(path.join(root, "supabase/functions/get-system-health-dashboard/index.ts"), "utf8");
const notifier = fs.readFileSync(path.join(root, "supabase/functions/notify-system-health-alert/index.ts"), "utf8");


test("persists private health, probe and alert state", function () {
  assert.match(migration, /create table if not exists private\.system_synthetic_probe_results/);
  assert.match(migration, /create table if not exists private\.system_health_runs/);
  assert.match(migration, /create table if not exists private\.system_health_alerts/);
  assert.match(migration, /revoke all on private\.system_health_runs from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on private\.system_health_runs to service_role/);
});

test("health scanner covers application, CSP, availability and scheduled jobs", function () {
  assert.match(migration, /application_errors_15m/);
  assert.match(migration, /http_5xx_15m/);
  assert.match(migration, /auth_errors_15m/);
  assert.match(migration, /csp_actionable_15m/);
  assert.match(migration, /synthetic_availability_failure/);
  assert.match(migration, /scheduled_job_failure/);
  assert.match(migration, /scheduled_jobs_stale/);
});

test("known Cloudflare beacon noise does not degrade CSP health", function () {
  assert.match(migration, /static\.cloudflareinsights\.com/);
  assert.match(migration, /csp_actionable_15m >= 10/);
});

test("synthetic probe is read only against production routes", function () {
  assert.match(syntheticProbe, /https:\/\/teacherflavius\.com\/health\.json/);
  assert.match(syntheticProbe, /method: "GET"/);
  assert.doesNotMatch(syntheticProbe, /method: "POST"[^\n]*teacherflavius\.com/);
  assert.match(syntheticProbe, /run_system_health_check_internal/);
});

test("dashboard access is JWT and MFA protected", function () {
  assert.match(dashboardFunction, /Authorization/);
  assert.match(dashboardFunction, /auth\.getUser/);
  assert.match(dashboardFunction, /is_teacher_admin_mfa/);
  assert.match(dashboardFunction, /get_system_health_dashboard_internal/);
});

test("system health alerts use signed webhook delivery and retries", function () {
  assert.match(migration, /teacherflavius_notification_webhook_secret/);
  assert.match(migration, /notify-system-health-alert/);
  assert.match(migration, /status = 'pending'/);
  assert.match(notifier, /x-webhook-secret/);
  assert.match(notifier, /RESEND_API_KEY/);
  assert.match(notifier, /finish_system_health_alert_delivery_internal/);
});

test("watchdog has bootstrap grace and remains independently scheduled", function () {
  assert.match(bootstrapFix, /system_health_monitor_config/);
  assert.match(bootstrapFix, /interval '15 minutes'/);
  assert.match(bootstrapFix, /bootstrap_grace/);
  assert.match(migration, /system-health-watchdog/);
  assert.match(migration, /4,14,24,34,44,54 \* \* \* \*/);
});
