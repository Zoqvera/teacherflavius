"""Stage 4/5: fail-closed release preflight contracts for lesson presentations."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.assess_lesson_presentation_rollout import assess, main

ROOT = Path(__file__).resolve().parents[1]


def inventory() -> dict[str, object]:
    return {
        "ledger_count": 316,
        "ledger_tip": "20261017110321",
        "stage1_migration_registered": False,
        "stage3_migration_registered": False,
        "presentations_table_exists": False,
        "versions_table_exists": False,
        "views_table_exists": False,
        "profiles_table_exists": True,
        "lesson_pages_table_exists": True,
        "teacher_admin_helper_exists": True,
        "production_data_examined": False,
        "production_write_authorized": False,
    }


class PresentationsStage4ReadinessTests(unittest.TestCase):
    def test_known_preflight_remains_blocked(self) -> None:
        result = assess(inventory())
        self.assertEqual(result["status"], "BLOCKED_PENDING_LEDGER_RECONCILIATION")
        self.assertEqual(result["ledger_count"], 316)
        self.assertFalse(result["automatic_migration_allowed"])
        self.assertFalse(result["automatic_release_allowed"])
        self.assertFalse(result["full_ledger_reconciliation_verified"])
        self.assertFalse(result["application_rls_verified_in_production"])

    def test_partial_migration_is_always_blocked(self) -> None:
        keys = (
            "stage1_migration_registered",
            "stage3_migration_registered",
            "presentations_table_exists",
            "versions_table_exists",
            "views_table_exists",
        )
        for key in keys:
            with self.subTest(key=key):
                data = inventory()
                data[key] = True
                self.assertEqual(
                    assess(data)["status"],
                    "BLOCKED_PARTIAL_OR_INCONSISTENT_DEPLOYMENT",
                )

    def test_fully_present_schema_is_still_not_automatic_approval(self) -> None:
        data = inventory()
        for name in (
            "stage1_migration_registered",
            "stage3_migration_registered",
            "presentations_table_exists",
            "versions_table_exists",
            "views_table_exists",
        ):
            data[name] = True
        status = assess(data)
        self.assertEqual(status["status"], "POST_DEPLOYMENT_SECURITY_REVIEW_REQUIRED")
        self.assertFalse(status["automatic_release_allowed"])
        self.assertFalse(status["production_write_authorized"])

    def test_missing_authorization_dependency_blocks(self) -> None:
        data = inventory()
        data["teacher_admin_helper_exists"] = False
        result = assess(data)
        self.assertEqual(result["status"], "BLOCKED_MISSING_PREREQUISITES")
        self.assertIn("teacher_admin_helper_exists", result["missing_prerequisites"])

    def test_untrusted_schema_or_sensitive_metadata_refused(self) -> None:
        for changes in (
            {"ledger_tip": "malformed"},
            {"ledger_count": -1},
            {"ledger_count": True},
            {"production_write_authorized": True},
            {"production_data_examined": True},
            {"stage1_migration_registered": "false"},
            {"student_email": "test@invalid.test"},
        ):
            with self.subTest(changes=changes):
                data = inventory()
                data.update(changes)
                with self.assertRaises(ValueError):
                    assess(data)

    def test_query_is_catalog_only_and_has_no_ddl_dml(self) -> None:
        sql = (ROOT / "scripts/sql/lesson_presentations_production_preflight_readonly.sql").read_text(
            encoding="utf-8"
        ).lower()
        self.assertIn("supabase_migrations.schema_migrations", sql)
        self.assertIn("to_regclass('public.lesson_presentations')", sql)
        self.assertIn("production_write_authorized', false", sql)
        for forbidden in (
            "drop table", "alter table", "insert into", "update public.",
            "delete from", "migration repair", "auth.users", "profiles.email",
            "profiles.name", "service_role",
        ):
            self.assertNotIn(forbidden, sql)

    def test_command_produces_only_metadata_flags(self) -> None:
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as directory:
            src = Path(directory) / "catalog.json"
            dst = Path(directory) / "decision.json"
            src.write_text(json.dumps(inventory()), encoding="utf-8")
            with patch("sys.argv", [
                "preflight", "--input", str(src), "--output", str(dst),
            ]):
                self.assertEqual(main(), 0)
            data = json.loads(dst.read_text(encoding="utf-8"))
            self.assertEqual(data["status"], "BLOCKED_PENDING_LEDGER_RECONCILIATION")
            self.assertNotIn("student_email", data)
            self.assertNotIn("student_name", data)


if __name__ == "__main__":
    unittest.main()
