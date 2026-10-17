"""Contracts for recovery-only LGPD relations and RLS (stage 1D.5)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RECOVERY = ROOT / "supabase/baseline/430_restore_lgpd_privacy_catalog_stage1d5.sql"
MIGRATIONS = (
    ROOT / "supabase/migrations/20260820231050_add_lgpd_data_subject_request_workflow.sql",
    ROOT / "supabase/migrations/20260820232656_expand_lgpd_data_subject_rights.sql",
    ROOT / "supabase/migrations/20260820233917_automate_data_retention_and_backup_cleanup.sql",
)
FINGERPRINT = ROOT / "supabase/baseline/schema-fingerprint.json"
RESTORE = ROOT / ".github/workflows/validate-supabase-baseline.yml"
SQL_TEST = ROOT / "tests/sql/canonical_lgpd_privacy_stage1d5.sql"
README = ROOT / "supabase/baseline/README.md"


class LgpdPrivacyBaselineContracts(unittest.TestCase):
    def test_recovered_tables_and_policies_originate_in_reviewed_migrations(self) -> None:
        recovery = RECOVERY.read_text(encoding="utf-8").lower()
        source = "\n".join(file.read_text(encoding="utf-8").lower() for file in MIGRATIONS)

        for name in ("data_subject_requests", "data_retention_policies", "data_retention_runs"):
            with self.subTest(name=name):
                self.assertIn(f"create table public.{name}", recovery)
                self.assertIn(f"public.{name} (", source)

        for policy in (
            "subjects_read_own_privacy_requests",
            "teacher_reads_privacy_requests",
            "teacher_reads_data_retention_policies",
            "teacher_reads_data_retention_runs",
        ):
            with self.subTest(policy=policy):
                self.assertIn(f"create policy {policy}", recovery)
                self.assertIn(f'"{policy}"', source)
        self.assertEqual(recovery.count("\ncreate policy "), 4)

    def test_recovery_never_runs_cleanup_or_installs_privileged_rpcs(self) -> None:
        recovery = RECOVERY.read_text(encoding="utf-8").lower()
        for prohibited in (
            "create or replace function",
            "create function",
            "cron.schedule",
            "cron.unschedule",
            "delete from public.",
            "insert into public.",
            "alter default privileges",
            "to public;",
            "to anon;",
        ):
            self.assertNotIn(prohibited, recovery)
        self.assertIn("lgpd_recovery_guard", recovery)
        self.assertIn("lgpd_recovery_verify", recovery)
        self.assertNotIn("homework_relationship_events", recovery)

    def test_student_requests_read_only_and_teacher_catalog_guarded(self) -> None:
        recovery = RECOVERY.read_text(encoding="utf-8")
        self.assertIn("using ((select auth.uid()) = subject_user_id)", recovery)
        self.assertEqual(
            recovery.count("using (coalesce(public.is_teacher_admin_mfa(), false))"),
            3,
        )
        self.assertEqual(recovery.lower().count("grant select on table public."), 3)
        for name in (
            "data_subject_requests",
            "data_retention_policies",
            "data_retention_runs",
        ):
            self.assertIn(
                f"revoke all on table public.{name} from public, anon, authenticated",
                recovery,
            )

    def test_disposable_postgresql_and_fingerprint_contracts(self) -> None:
        fingerprint = json.loads(FINGERPRINT.read_text(encoding="utf-8"))
        self.assertEqual(fingerprint["tables"], 55)
        self.assertEqual(fingerprint["constraints"], 277)
        self.assertEqual(fingerprint["non_constraint_indexes"], 120)
        self.assertEqual(fingerprint["rls_policies"], 99)
        workflow = RESTORE.read_text(encoding="utf-8")
        self.assertIn(RECOVERY.name, workflow)
        self.assertIn(SQL_TEST.name, workflow)
        sql_test = SQL_TEST.read_text(encoding="utf-8")
        for marker in (
            "set local role authenticated",
            "rollback;",
            "subject_user_id <> auth.uid()",
            "LGPD teacher read policies",
        ):
            self.assertIn(marker, sql_test)
        self.assertIn("Stage 1D.5", README.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
