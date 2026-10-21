"""Schema-only replica contract for the reviewed credit-justification migration."""
from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "supabase/migrations/20261016162500_justify_attended_cancelled_lesson_revocations.sql"
OVERLAY = ROOT / "supabase/baseline/400_justify_attended_cancelled_lesson_revocations.sql"
FINGERPRINT = ROOT / "supabase/baseline/schema-fingerprint.json"
WORKFLOW = ROOT / ".github/workflows/validate-supabase-baseline.yml"


class CreditJustificationBaselineTests(unittest.TestCase):
    def test_exact_reviewed_source_is_restored_without_new_business_logic(self) -> None:
        original = SOURCE.read_text(encoding="utf-8")
        replay = OVERLAY.read_text(encoding="utf-8")
        self.assertTrue(replay.endswith(original))
        self.assertIn("Schema-only disaster-recovery overlay", replay)

    def test_recovery_overlay_is_after_prior_credit_overlays(self) -> None:
        text = WORKFLOW.read_text(encoding="utf-8")
        legacy = "supabase/baseline/395_student_review_invitation_funnel.sql"
        new = "supabase/baseline/400_justify_attended_cancelled_lesson_revocations.sql"
        self.assertEqual(text.count(new), 1)
        self.assertLess(text.index(legacy), text.index(new))

    def test_private_justifications_restrict_browser_access(self) -> None:
        sql = OVERLAY.read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists private.lesson_credit_revocation_justifications", sql)
        self.assertIn("alter table private.lesson_credit_revocation_justifications enable row level security", sql)
        self.assertIn("revoke all on private.lesson_credit_revocation_justifications from public, anon, authenticated", sql)
        self.assertIn("revoke all on function public.justify_teacher_attended_cancelled_lesson(uuid)", sql)
        self.assertIn("if (select auth.uid()) is null or not coalesce(public.is_teacher_admin(), false)", sql)

    def test_schema_fingerprint_is_incremental_and_never_accepts_data_rows(self) -> None:
        fingerprint = json.loads(FINGERPRINT.read_text(encoding="utf-8"))
        self.assertGreaterEqual(int(fingerprint["captured_from_migration_version"]), 20261016162500)
        self.assertEqual(fingerprint["public_functions"], 197)
        self.assertEqual(fingerprint["tables"], 55)
        self.assertEqual(fingerprint["rls_policies"], 99)


if __name__ == "__main__":
    unittest.main()
