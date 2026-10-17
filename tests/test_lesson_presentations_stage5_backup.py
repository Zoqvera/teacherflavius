"""Metadata-only stage 5 production-backup readiness safety contracts."""

from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from scripts.assess_lesson_presentation_backup import assess, main

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 10, 17, 15, 0, tzinfo=timezone.utc)


def report(*, hours_old: int = 1) -> dict[str, object]:
    captured = NOW - timedelta(hours=hours_old)
    verified = captured + timedelta(minutes=4)
    return {
        "status": "passed",
        "verified_at": verified.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "backup_captured_at": captured.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rto_exercise_seconds": 190,
        "rpo_design_hours": 24,
        "manifest_format_version": 3,
        "presentation_schema_rehearsal": "passed",
    }


class Stage5BackupReadinessTests(unittest.TestCase):
    def test_fresh_verified_backup_does_not_allow_production_writes(self) -> None:
        a = assess(report(), now=NOW)
        self.assertEqual(a["status"], "RECOVERY_EVIDENCE_CURRENT")
        self.assertTrue(a["verified_restored_catalog_rehearsal"])
        self.assertFalse(a["production_write_authorized"])
        self.assertFalse(a["automatic_migration_allowed"])
        self.assertFalse(a["automatic_release_allowed"])
        self.assertFalse(a["ledger_alignment_verified"])
        self.assertTrue(a["requires_independent_production_approval"])

    def test_old_or_clock_inconsistent_backup_remains_blocked(self) -> None:
        for age in (25, 48):
            with self.subTest(age=age):
                r = assess(report(hours_old=age), now=NOW)
                self.assertEqual(r["status"], "BLOCKED_BACKUP_STALE_OR_CLOCK_INCONSISTENT")
        r = report()
        r["verified_at"] = (NOW + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.assertEqual(
            assess(r, now=NOW)["status"], "BLOCKED_BACKUP_STALE_OR_CLOCK_INCONSISTENT"
        )

    def test_forged_broken_or_data_bearing_report_is_rejected(self) -> None:
        for changes in (
            {"status": "failed"},
            {"presentation_schema_rehearsal": "skipped"},
            {"manifest_format_version": 2},
            {"rto_exercise_seconds": "190"},
            {"rpo_design_hours": True},
            {"backup_captured_at": "2026-13-99"},
            {"student_name": "should-not-appear"},
            {"database_url": "should-not-appear"},
        ):
            with self.subTest(changes=changes):
                r = report()
                r.update(changes)
                with self.assertRaises(ValueError):
                    assess(r, now=NOW)

    def test_readiness_cli_emits_public_safe_flags(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            src = Path(temp) / "recovery-report.json"
            dst = Path(temp) / "readiness.json"
            src.write_text(json.dumps(report()), encoding="utf-8")
            with patch("sys.argv", [
                "test", "--report", str(src), "--output", str(dst),
                "--as-of-utc", NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
            ]):
                self.assertEqual(main(), 0)
            result = json.loads(dst.read_text(encoding="utf-8"))
            self.assertEqual(result["status"], "RECOVERY_EVIDENCE_CURRENT")
            self.assertFalse(result["production_write_authorized"])
            self.assertFalse(result["automatic_release_allowed"])

    def test_no_new_migrations_or_release_gate_bypass_in_this_stage(self) -> None:
        for item in ("lesson_presentation_editor.js", "teacher_lesson_presentations.js"):
            self.assertIn(
                "const RELEASE_ENABLED = false;",
                (ROOT / item).read_text(encoding="utf-8"),
            )
        for item in (
            "scripts/assess_lesson_presentation_backup.py",
            "tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql",
        ):
            content = (ROOT / item).read_text(encoding="utf-8").lower()
            self.assertNotIn("service_role_key", content)
            self.assertNotIn("drop table", content)
            self.assertNotIn("supabase_migrations.schema_migrations", content)


if __name__ == "__main__":
    unittest.main()
