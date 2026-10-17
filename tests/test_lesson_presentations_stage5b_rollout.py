"""Contract checks for the guarded Stage 5B production schema transaction."""
from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def source(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class PresentationStage5BContractTests(unittest.TestCase):
    def test_transaction_preserves_original_migration_versions(self) -> None:
        sql = source("scripts/sql/lesson_presentations_stage5b_transactional_rollout.sql")
        self.assertIn("migration_count <> 316", sql)
        self.assertIn("migration_tip <> '20261017110321'", sql)
        self.assertIn("lock table supabase_migrations.schema_migrations", sql)
        self.assertIn("pg_advisory_xact_lock", sql)
        self.assertIn("\\ir ../../supabase/migrations/20261017133000_lesson_presentations_stage1.sql", sql)
        self.assertIn("\\ir ../../supabase/migrations/20261017144500_lesson_presentation_views_stage3.sql", sql)
        self.assertIn("('20261017133000', 'lesson_presentations_stage1')", sql)
        self.assertIn("('20261017144500', 'lesson_presentation_views_stage3')", sql)
        self.assertIn("actual_policies <> 6", sql)
        self.assertIn("not c.relrowsecurity", sql)
        self.assertIn("actual_triggers <> 2", sql)
        self.assertIn("must be empty at rollout", sql)
        self.assertNotIn("drop table", sql.lower())
        self.assertNotIn("migration repair", sql.lower())
        self.assertNotIn("delete from", sql.lower())

    def test_apply_sh_runs_the_entire_sql_in_one_transaction(self) -> None:
        script = source("scripts/apply_lesson_presentations_stage5b.sh")
        self.assertIn("--single-transaction", script)
        self.assertIn("--set=ON_ERROR_STOP=1", script)
        self.assertIn("refs/heads/main", script)
        self.assertIn("CONFIRMO_APRESENTACOES_5B", script)
        self.assertIn("SUPABASE_DB_URL", script)
        self.assertNotIn("supabase db push", script)
        self.assertNotIn("migration repair", script)

    def test_recovery_evidence_is_recent_and_source_attested(self) -> None:
        script = source("scripts/verify_lesson_presentations_stage5b_evidence.sh")
        self.assertIn("BACKUP_RUN_ID=39043019631", script)
        self.assertIn("RECOVERY_RUN_ID=39043160705", script)
        self.assertIn("backup_sha", script)
        self.assertIn("recovery_sha", script)
        self.assertIn("assess_lesson_presentation_backup.py", script)
        self.assertIn("RECOVERY_EVIDENCE_CURRENT", script)
        assessor = source("scripts/assess_lesson_presentation_backup.py")
        self.assertIn("max_age = timedelta(hours=24)", assessor)
        self.assertIn('"automatic_migration_allowed": False', assessor)

    def test_automatic_rollout_is_restricted_to_one_main_workflow_change(self) -> None:
        workflow = source(".github/workflows/lesson-presentations-stage5b-production.yml")
        self.assertIn("branches:\n      - main", workflow)
        self.assertIn("paths:\n      - '.github/workflows/lesson-presentations-stage5b-production.yml'", workflow)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("permissions:\n  contents: read\n  actions: read", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("verify_lesson_presentations_stage5b_evidence.sh", workflow)
        self.assertIn("apply_lesson_presentations_stage5b.sh", workflow)
        self.assertNotIn("pull_request_target", workflow)

    def test_code_gates_stay_disabled_until_production_security_review(self) -> None:
        for path in ("lesson_presentation_editor.js", "teacher_lesson_presentations.js"):
            self.assertIn("const RELEASE_ENABLED = false;", source(path))


if __name__ == "__main__":
    unittest.main()
