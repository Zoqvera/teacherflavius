"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const preflight = read("scripts/sql/teacher_v2_stage7c_readonly_preflight.sql");
const rollback = read("scripts/sql/teacher_v2_stage7c_disable_worker.sql");
const app = read("roteiro-da-aula-v2/app.js");
const teacherDashboard = read("professor.html");
const current = read("roteiro-da-aula/index.html");
const preview = read("roteiro-da-aula-v2/index.html");
const legacy = read("roteiro-da-aula-legado/index.html");
const robots = read("robots.txt");

test("production preflight is strictly read-only and checks exact migration ledger", () => {
  assert.match(preflight, /BEGIN READ ONLY;/);
  assert.match(preflight, /SET LOCAL statement_timeout = '15s';/);
  assert.match(preflight, /versions_count <> 358/);
  assert.match(preflight, /latest_version <> '20261023150740'/);
  assert.match(preflight, /installed_v2_migrations <> 5/);
  assert.match(preflight, /cardinality\(statements\) = 1/);
  assert.doesNotMatch(preflight, /\b(?:UPDATE|DELETE|INSERT|ALTER|TRUNCATE|CREATE TABLE|DROP TABLE)\s+(?:TABLE\s+)?(?:private\.|public\.|supabase_migrations\.)/i);
});

test("preflight rejects unsafe worker, RLS and anonymous grants", () => {
  assert.match(preflight, /protected_tables <> 3/);
  assert.match(preflight, /has_function_privilege\('anon'/);
  assert.match(preflight, /worker_jobs <> 1/);
  assert.match(preflight, /enabled = false AND enabled_from IS NULL/);
  assert.match(preflight, /academic_v2_closed_session_snapshots/);
  assert.match(preflight, /academic_v2_attendance_audit/);
});

test("rollback disables only the automation row under the common writer lock", () => {
  assert.match(rollback, /BEGIN;/);
  assert.match(rollback, /pg_catalog\.pg_advisory_xact_lock\(20261022, 4\)/);
  assert.match(rollback, /UPDATE private\.academic_v2_automation_control\s+SET enabled = false, enabled_from = NULL\s+WHERE singleton = true;/);
  assert.match(rollback, /GET DIAGNOSTICS affected = ROW_COUNT;/);
  assert.match(rollback, /affected <> 1/);
  assert.match(rollback, /COMMIT;/);
  assert.doesNotMatch(rollback, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE|UPDATE public\.|INSERT INTO|cron\.unschedule)\b/i);
});

test("v2 manual recording now powers canonical route with legacy and worker fallback", () => {
  for (const flag of [
    "PRESENTATION_REGISTRATION_ENABLED",
    "QUESTION_RATINGS_ENABLED",
    "SESSION_LIFECYCLE_ENABLED"
  ]) {
    assert.match(app, new RegExp("const " + flag + " = true;"));
  }
  assert.match(teacherDashboard, /href="\/roteiro-da-aula\/"/);
  assert.match(current, /src="\/roteiro-da-aula-v2\/app\.js/);
  assert.match(legacy, /src="\/roteiro-da-aula\/app\.js/);
  assert.match(current, /href="\/roteiro-da-aula-legado\/"/);
  assert.match(robots, /Disallow: \/roteiro-da-aula-legado\//);
  assert.match(robots, /Disallow: \/roteiro-da-aula-v2\//);
  assert.match(current, /<meta name="robots" content="noindex, nofollow">/);
  assert.match(preview, /<meta name="robots" content="noindex, nofollow">/);
});
