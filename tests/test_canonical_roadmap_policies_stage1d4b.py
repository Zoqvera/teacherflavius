"""Contracts for recovery-only academic RLS policies."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RECOVERY = ROOT / "supabase/baseline/425_restore_roadmap_teacher_and_exercise_read_policies.sql"
ORIGINAL = ROOT / "supabase/migrations/20260909071400_restrict_study_roadmap_completion_to_teacher.sql"
SUSPENSION = ROOT / "supabase/migrations/20261015135322_suspend_legacy_student_exercise_portal.sql"
FINGERPRINT = ROOT / "supabase/baseline/schema-fingerprint.json"
RESTORE = ROOT / ".github/workflows/validate-supabase-baseline.yml"
SQL_TEST = ROOT / "tests/sql/canonical_roadmap_exercise_policies_stage1d4b.sql"


class AcademicRlsRecoveryContracts(unittest.TestCase):
    def test_all_four_policies_match_reviewed_migration_identifiers(self) -> None:
        recovery = RECOVERY.read_text(encoding="utf-8")
        source = ORIGINAL.read_text(encoding="utf-8")
        suspension = SUSPENSION.read_text(encoding="utf-8")
        roadmap = (
            "Professor pode inserir progresso do roteiro",
            "Professor pode atualizar progresso do roteiro",
            "Professor pode excluir progresso do roteiro",
        )
        for name in roadmap:
            self.assertIn(f'create policy "{name}"', recovery)
            self.assertIn(f'create policy "{name}"', source)
        name = "Apenas professores podem visualizar exercícios durante suspensão"
        self.assertIn(f'create policy "{name}"', recovery)
        self.assertIn(f'create policy "{name}"', suspension)
        self.assertEqual(recovery.lower().count("\ncreate policy "), 4)

    def test_no_student_mutations_or_exercise_reactivation(self) -> None:
        recovery = RECOVERY.read_text(encoding="utf-8")
        sql_test = SQL_TEST.read_text(encoding="utf-8")
        self.assertIn("Direct student roadmap mutations must stay disabled", recovery)
        self.assertIn("Exercise portal must remain teacher-only during suspension", sql_test)
        self.assertNotIn("create function", recovery.lower())
        self.assertNotIn("create table", recovery.lower())
        self.assertNotIn("grant select to anon", recovery.lower())
        self.assertNotIn("cron.schedule", recovery.lower())

    def test_catalog_and_real_database_checks(self) -> None:
        fp = json.loads(FINGERPRINT.read_text(encoding="utf-8"))
        self.assertEqual(fp["rls_policies"], 95)
        self.assertEqual(fp["tables"], 53)
        wf = RESTORE.read_text(encoding="utf-8")
        self.assertIn("425_restore_roadmap_teacher_and_exercise_read_policies.sql", wf)
        self.assertIn("tests/sql/canonical_roadmap_exercise_policies_stage1d4b.sql", wf)


if __name__ == "__main__":
    unittest.main()
