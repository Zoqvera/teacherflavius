"""Contract tests for schema-only academic relationship storage recovery."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HISTORY = ROOT / "supabase/migrations/20261016144000_homeworks_formal_relationship_retention.sql"
OVERLAY = ROOT / "supabase/baseline/410_restore_academic_relationship_event_storage.sql"
WORKFLOW = ROOT / ".github/workflows/validate-supabase-baseline.yml"
SQL_TEST = ROOT / "tests/sql/canonical_academic_rls_stage1d3.sql"
PAGES = ROOT / "supabase/baseline/45_add_study_lesson_pages.sql"
FINGERPRINT = ROOT / "supabase/baseline/schema-fingerprint.json"

BOUNDARY = "-- Somente um professor com MFA pode declarar o encerramento ou a retomada."


class AcademicRelationshipBaselineTests(unittest.TestCase):
    def test_storage_sql_matches_reviewed_migration_prefix(self) -> None:
        historical = HISTORY.read_text(encoding="utf-8")
        recovery = OVERLAY.read_text(encoding="utf-8")
        prefix, remainder = historical.split(BOUNDARY, maxsplit=1)
        self.assertTrue(recovery.endswith(prefix.strip() + "\n"))
        self.assertIn("create function public.homework_record_relationship_event", remainder)
        self.assertNotIn("create function", recovery)
        self.assertNotIn("cron.schedule", recovery)

    def test_table_is_rls_protected_and_not_browsable(self) -> None:
        content = OVERLAY.read_text(encoding="utf-8").lower()
        self.assertIn("alter table public.homework_relationship_events enable row level security", content)
        self.assertIn("revoke all on public.homework_relationship_events from public, anon, authenticated", content)
        self.assertIn("revoke all on sequence public.homework_relationship_events_id_seq", content)
        self.assertIn("grant select, insert on public.homework_relationship_events to service_role", content)
        self.assertNotIn("create policy", content)

    def test_isolated_restore_reuses_only_remaining_migration(self) -> None:
        script = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("supabase/baseline/410_restore_academic_relationship_event_storage.sql", script)
        self.assertIn("sed -n '/^-- Somente um professor com MFA pode declarar/,$p'", script)
        self.assertIn("tests/sql/canonical_academic_rls_stage1d3.sql", script)

    def test_lesson_page_policies_remain_strict_mfa(self) -> None:
        baseline = PAGES.read_text(encoding="utf-8")
        test = SQL_TEST.read_text(encoding="utf-8")
        self.assertEqual(baseline.count("public.is_teacher_admin_mfa()"), 5)
        self.assertIn("student_page_count <> 1 or teacher_page_count <> 3", test)
        self.assertIn("Academic relationship events must not expose client policies", test)

    def test_mode_repair_preserves_predicates_and_fails_closed(self) -> None:
        sql = (
            ROOT / "supabase/baseline/415_reconcile_canonical_policy_modes.sql"
        ).read_text(encoding="utf-8")
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("restrictive_count <> 81", sql)
        self.assertIn("roles <> array['authenticated']::name[]", sql)
        self.assertIn("before_signature is distinct from after_signature", sql)
        self.assertIn("policy_row.qual", sql)
        self.assertIn("policy_row.with_check", sql)
        self.assertIn("as permissive", sql)
        self.assertIn("415_reconcile_canonical_policy_modes.sql", workflow)
        self.assertNotIn("supabase_migrations", sql)
        self.assertNotIn("cron.schedule", sql)

    def test_recovery_fingerprint_counts_public_table_constraints_and_index(self) -> None:
        fingerprint = json.loads(FINGERPRINT.read_text(encoding="utf-8"))
        self.assertEqual(fingerprint["tables"], 53)
        self.assertEqual(fingerprint["constraints"], 271)
        self.assertEqual(fingerprint["non_constraint_indexes"], 117)
        self.assertEqual(fingerprint["rls_policies"], 95)


if __name__ == "__main__":
    unittest.main()
