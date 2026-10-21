"""Regression tests for UTC backup timestamps emitted by PostgreSQL jsonb."""
from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from assess_lesson_presentation_backup import _utc_timestamp, assess  # noqa: E402


def report(captured: str, verified: str) -> dict[str, object]:
    return {
        "status": "passed",
        "verified_at": verified,
        "backup_captured_at": captured,
        "rto_exercise_seconds": 180,
        "rpo_design_hours": 24,
        "manifest_format_version": 3,
        "presentation_schema_rehearsal": "passed",
    }


class BackupTimestampTests(unittest.TestCase):
    NOW = datetime(2026, 10, 17, 16, 12, 50, tzinfo=timezone.utc)

    def test_postgres_fractional_utc_offset_is_accepted(self) -> None:
        result = assess(
            report(
                "2026-10-17T14:59:10.123456+00:00",
                "2026-10-17T15:03:04Z",
            ),
            now=self.NOW,
        )
        self.assertEqual(result["status"], "RECOVERY_EVIDENCE_CURRENT")
        self.assertEqual(result["production_write_authorized"], False)
        self.assertEqual(result["automatic_release_allowed"], False)

    def test_utc_z_and_offset_formats_are_equal(self) -> None:
        expected = datetime(2026, 10, 17, 14, 59, 10, tzinfo=timezone.utc)
        for value in (
            "2026-10-17T14:59:10Z",
            "2026-10-17T14:59:10+00:00",
            "2026-10-17T14:59:10+0000",
            "2026-10-17T14:59:10+00",
        ):
            with self.subTest(value=value):
                self.assertEqual(_utc_timestamp(value, "captured"), expected)

    def test_timezone_and_format_bypass_attempts_are_rejected(self) -> None:
        invalid = (
            "2026-10-17T14:59:10",
            "2026-10-17T14:59:10-03:00",
            "2026-10-17T14:59:10+03:00",
            "2026-10-17 14:59:10+00:00",
            "2026-10-17T14:59:10Z extra",
            "2026-10-17T14:59:10.1234567+00:00",
            "2026-13-17T14:59:10+00:00",
            None,
        )
        for value in invalid:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    _utc_timestamp(value, "captured")

    def test_stale_backup_is_rejected(self) -> None:
        result = assess(
            report("2026-10-16T12:00:00+00:00", "2026-10-16T12:05:00Z"),
            now=self.NOW,
        )
        self.assertEqual(result["status"], "BLOCKED_BACKUP_STALE_OR_CLOCK_INCONSISTENT")

    def test_future_or_out_of_order_verification_is_rejected(self) -> None:
        for captured, verified in (
            ("2026-10-17T15:05:00+00:00", "2026-10-17T15:00:00Z"),
            ("2026-10-17T15:00:00+00:00", "2026-10-17T16:15:00Z"),
        ):
            with self.subTest(captured=captured, verified=verified):
                result = assess(report(captured, verified), now=self.NOW)
                self.assertEqual(
                    result["status"], "BLOCKED_BACKUP_STALE_OR_CLOCK_INCONSISTENT"
                )

    def test_unexpected_metadata_never_authorizes(self) -> None:
        payload = report("2026-10-17T14:59:10+00:00", "2026-10-17T15:03:04Z")
        payload["secret"] = "must-not-be-accepted"
        with self.assertRaises(ValueError):
            assess(payload, now=self.NOW)

    def test_failed_schema_rehearsal_is_rejected(self) -> None:
        payload = report("2026-10-17T14:59:10+00:00", "2026-10-17T15:03:04Z")
        payload["presentation_schema_rehearsal"] = "failed"
        with self.assertRaises(ValueError):
            assess(payload, now=self.NOW)


if __name__ == "__main__":
    unittest.main()
