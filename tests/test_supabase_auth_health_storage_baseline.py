"""Contract tests for partial private Auth health storage reconstruction."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260910163542_add_auth_account_health_monitoring.sql"
OVERLAY = ROOT / "supabase/baseline/405_restore_auth_account_health_run_storage.sql"
WORKFLOW = ROOT / ".github/workflows/validate-supabase-baseline.yml"


class AuthHealthStorageBaselineTests(unittest.TestCase):
    def test_recovery_storage_equals_reviewed_source_prefix(self):
        original = MIGRATION.read_text(encoding="utf-8")
        recovered = OVERLAY.read_text(encoding="utf-8")
        target = original.split(
            "create or replace function private.run_auth_account_health_check", 1
        )
        self.assertEqual(len(target), 2)
        self.assertTrue(recovered.endswith(target[0].strip() + "\n"))

    def test_storage_is_private_with_no_browser_grants(self):
        recovered = OVERLAY.read_text(encoding="utf-8").lower()
        self.assertIn("create table if not exists private.auth_account_health_runs", recovered)
        self.assertIn("revoke all on table private.auth_account_health_runs from public, anon, authenticated", recovered)
        self.assertIn("grant select, insert, update, delete on table private.auth_account_health_runs to service_role", recovered)
        self.assertNotIn("create or replace function private.run_auth_account_health_check", recovered)
        self.assertNotIn("cron.schedule", recovered)
        self.assertNotIn("http_post", recovered)

    def test_overlay_order_is_append_only(self):
        wf = WORKFLOW.read_text(encoding="utf-8")
        prior = "supabase/baseline/400_justify_attended_cancelled_lesson_revocations.sql"
        current = "supabase/baseline/405_restore_auth_account_health_run_storage.sql"
        self.assertEqual(wf.count(current), 1)
        self.assertLess(wf.index(prior), wf.index(current))


if __name__ == "__main__":
    unittest.main()
