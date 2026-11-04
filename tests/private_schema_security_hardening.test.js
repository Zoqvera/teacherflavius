// Contract for the production hardening applied on 2026-11-04 (UTC).
// These checks prevent accidental permissive policies and missing migration files.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { createHash } = require("node:crypto");
const path = require("node:path");

const MIGRATIONS = Object.freeze([
  "20261104013111_secure_private_billing_plan_rls.sql",
  "20261104013135_harden_private_rls_group_1_nov_2026.sql",
  "20261104013138_harden_private_rls_group_2_nov_2026.sql",
  "20261104013141_harden_private_rls_group_3_nov_2026.sql",
  "20261104013215_remove_browser_execute_grants_from_private_routines.sql",
]);


const EXPECTED_MIGRATION_SHA256 = Object.freeze({
  "20261104013111_secure_private_billing_plan_rls.sql": "679cbd483d1bd1b0a80062bf21b4dbac9f2eed63ac6e2187db46ccf894f7ade9",
  "20261104013135_harden_private_rls_group_1_nov_2026.sql": "0a8104d60366a142854ae7e4b7398d7ff75ada96daf252d1556c0d2f7b8bd74a",
  "20261104013138_harden_private_rls_group_2_nov_2026.sql": "46484d5154301c9a8f3f7e9487ca165ba753d7f3008d7a9eeabaed4c81640322",
  "20261104013141_harden_private_rls_group_3_nov_2026.sql": "886c94285a5bc621b1594db8755fce2810016e47d64890fe2afc72a618a306a1",
  "20261104013215_remove_browser_execute_grants_from_private_routines.sql": "63159485bd9f37db4007ea9b31f93a53cd7b7845cedbb9281ebabbdfed981ad2"
});

const EXPECTED_TABLES = new Set([
  "academic_class_session_finalizations",
  "academic_lesson_occurrences",
  "academic_non_instructional_class_dates",
  "administrative_weekly_plans",
  "auth_account_health_runs",
  "billing_plans",
  "conversation_question_practice_log",
  "lesson_credits",
  "mercado_pago_tuition_allocations",
  "operational_data_quality_runs",
  "payment_creation_control",
  "payment_creation_control_events",
  "payment_financial_health_runs",
  "student_lesson_preparations",
  "student_policy_acceptances",
  "student_question_studies",
  "student_regular_lesson_restorations",
  "system_health_alerts",
  "system_health_monitor_config",
  "system_health_runs",
  "system_synthetic_probe_results",
  "teacher_administrative_enrollment_drafts",
  "web_push_configuration",
  "web_push_notification_deliveries",
  "web_push_subscriptions",
]);

function loadStatements() {
  return MIGRATIONS.flatMap((fileName) => {
    const migrationPath = path.join(
      __dirname, "..", "supabase", "migrations", fileName
    );
    const content = fs.readFileSync(migrationPath, "utf8");
    return content
      .replace(/^\s*--.*$/gm, "")
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
  });
}

test("all 25 audited private tables have explicit RLS migrations", () => {
  const statements = loadStatements();
  const rlsStatements = statements.filter((statement) =>
    /^alter table private\./i.test(statement)
  );
  const tables = rlsStatements.map((statement) => {
    const match = statement.match(
      /^alter table private\.([a-z_]+) enable row level security$/i
    );
    assert.ok(match, "Unexpected table-altering statement");
    return match[1];
  });

  assert.equal(tables.length, EXPECTED_TABLES.size);
  assert.equal(new Set(tables).size, EXPECTED_TABLES.size);
  assert.deepEqual(new Set(tables), EXPECTED_TABLES);
});

test("the hardening grants no new browser access", () => {
  const statements = loadStatements();
  const revocations = statements.filter((statement) =>
    /^revoke execute /i.test(statement)
  );

  assert.equal(statements.length, EXPECTED_TABLES.size + 1);
  assert.deepEqual(revocations, [
    "revoke execute on all functions in schema private from public, anon, authenticated",
  ]);
  assert.ok(
    statements.every((statement) =>
      /^alter table private\.[a-z_]+ enable row level security$/i.test(statement) ||
      /^revoke execute on all functions in schema private from public, anon, authenticated$/i.test(statement)
    ),
    "Hardening must not introduce a policy, a GRANT, or a data mutation"
  );
});

test("migration SQL bytes match immutable production ledger hashes", () => {
  for (const fileName of MIGRATIONS) {
    const filePath = path.join(
      __dirname, "..", "supabase", "migrations", fileName
    );
    const sql = fs.readFileSync(filePath, "utf8");
    const digest = createHash("sha256").update(sql).digest("hex");
    assert.equal(digest, EXPECTED_MIGRATION_SHA256[fileName], fileName);
  }
});
