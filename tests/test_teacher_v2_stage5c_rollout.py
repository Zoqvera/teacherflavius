"""Contract tests for stage 5C, schema-only manual deployment."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class TeacherV2Stage5CContracts(unittest.TestCase):
    def test_schema_rollout_is_selective_and_fails_on_schema_drift(self):
        sql = read("scripts/sql/teacher_v2_stage5c_selective_rollout.sql")
        self.assertIn("versions_count <> 353", sql)
        self.assertIn("latest_version <> '20261023150740'", sql)
        self.assertIn("version = '20261023150740'", sql)
        self.assertIn("name = 'allow_friday_trial_meet_access'", sql)
        self.assertIn("2335796706ca4ff62a9902f0588d167174f5780cf82c0f5fdd5a2225b9f5fdb0", sql)
        self.assertIn("sha256(convert_to(statements[1], 'UTF8'))", sql)
        self.assertIn("lock table supabase_migrations.schema_migrations", sql)
        self.assertIn("pg_advisory_xact_lock", sql)
        self.assertIn("schema_migrations(version,name,statements)", sql)
        self.assertIn("cardinality(statements) <> 1", sql)
        self.assertIn("ARRAY[:'v2_sql_1']::text[]", sql)
        for version in ("20261022202000", "20261022212500",
                        "20261022214500", "20261022220000",
                        "20261022234500"):
            self.assertIn(f"../../supabase/migrations/{version}_", sql)
            self.assertIn(f"('{version}'", sql)
        self.assertIn("enabled=false and enabled_from is null", sql)
        self.assertIn("private.run_teacher_v2_auto_finalizations()", sql)
        self.assertIn("count(*) from supabase_migrations.schema_migrations) <> 358", sql)
        self.assertIn("has_function_privilege('anon'", sql)
        self.assertIn("not c.relrowsecurity", sql)
        self.assertIn("if exists (select 1 from private.academic_v2_closed_session_snapshots)", sql)
        self.assertNotIn("drop table ", sql.lower())
        self.assertNotIn("migration repair", sql.lower())
        self.assertNotIn("delete from public.student_frequency", sql.lower())

    def test_script_rejects_automatic_dispatch_and_rolls_back_on_sql_error(self):
        script = read("scripts/apply_teacher_v2_stage5c.sh")
        for guard in ("workflow_dispatch", "refs/heads/main",
                      "CONFIRMO_ROTEIRO_V2_5C", "--single-transaction",
                      "--set=ON_ERROR_STOP=1", "SUPABASE_DB_URL"):
            self.assertIn(guard, script)
        self.assertIn("git hash-object", script)
        self.assertIn('sql_arguments+=(--set="v2_sql_', script)
        self.assertNotIn("supabase db push", script)

    def test_fresh_restorable_backup_and_own_commit_disposable_test_required(self):
        verifier = read("scripts/verify_teacher_v2_stage5c_evidence.sh")
        self.assertIn("verify_lesson_presentations_stage5b_evidence.sh", verifier)
        self.assertIn("validate-supabase-baseline.yml", verifier)
        self.assertIn("workflow_dispatch", verifier)
        self.assertIn("head_sha == $sha", verifier)
        self.assertIn("conclusion == \"success\"", verifier)
        self.assertIn("< 86400", verifier)

    def test_workflow_requires_explicit_manual_approval_without_push_or_schedule(self):
        workflow = read(".github/workflows/teacher-v2-stage5c-schema.yml")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("CONFIRMO_ROTEIRO_V2_5C", workflow)
        self.assertIn("if: github.ref == 'refs/heads/main'", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("count(*) = 358", workflow)
        self.assertIn("max(version) = '20261023150740'", workflow)
        self.assertIn("verify_teacher_v2_stage5c_evidence.sh", workflow)
        self.assertIn("apply_teacher_v2_stage5c.sh", workflow)
        self.assertNotIn("  push:", workflow)
        self.assertNotIn("pull_request_target", workflow)
        self.assertNotIn("supabase db push", workflow)

    def test_existing_page_and_new_automation_are_not_activated(self):
        app = read("roteiro-da-aula-v2/app.js")
        for gate in ("PRESENTATION_REGISTRATION_ENABLED",
                     "QUESTION_RATINGS_ENABLED", "SESSION_LIFECYCLE_ENABLED"):
            self.assertIn(f"const {gate} = false;", app)
        self.assertIn("src=\"/roteiro-da-aula/app.js", read("roteiro-da-aula/index.html"))


if __name__ == "__main__":
    unittest.main()
