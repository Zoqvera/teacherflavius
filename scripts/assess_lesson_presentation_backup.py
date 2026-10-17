#!/usr/bin/env python3
"""Assess verified backup freshness before a proposed presentation rollout.

Read-only. The input is a *metadata-only* disposable recovery report; no
database credentials, backup payload, student records, or authorization to
change production are accepted.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def _utc_timestamp(value: object, name: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a UTC timestamp.")
    try:
        parsed = datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ")
    except ValueError as error:
        raise ValueError(f"Invalid {name} timestamp.") from error
    return parsed.replace(tzinfo=timezone.utc)


def assess(report: dict[str, object], *, now: datetime) -> dict[str, object]:
    """Never approve production DDL, even for a fresh and recoverable archive."""
    if not isinstance(report, dict):
        raise ValueError("Recovery report must be an object.")
    expected = {
        "status", "verified_at", "backup_captured_at",
        "rto_exercise_seconds", "rpo_design_hours",
        "manifest_format_version", "presentation_schema_rehearsal",
    }
    if set(report) != expected:
        raise ValueError("Unexpected backup report keys (sensitive metadata rejected).")
    if report["status"] != "passed":
        raise ValueError("Restore must have passed.")
    if type(report["rto_exercise_seconds"]) is not int or not (
        0 <= report["rto_exercise_seconds"] <= 86400
    ):
        raise ValueError("Invalid restore duration.")
    if type(report["rpo_design_hours"]) is not int or report["rpo_design_hours"] != 24:
        raise ValueError("Unexpected backup cadence.")
    if type(report["manifest_format_version"]) is not int or report["manifest_format_version"] != 3:
        raise ValueError("Unsupported manifest format.")
    if report["presentation_schema_rehearsal"] != "passed":
        raise ValueError("Presentation DDL-on-restored-backup rehearsal is missing.")
    if now.tzinfo is None:
        raise ValueError("Evaluation clock must be timezone-aware.")
    now = now.astimezone(timezone.utc)
    captured = _utc_timestamp(report["backup_captured_at"], "backup_captured_at")
    verified = _utc_timestamp(report["verified_at"], "verified_at")
    valid_order = captured <= verified <= now
    age = now - captured
    max_age = timedelta(hours=24)
    fresh = valid_order and timedelta() <= age <= max_age
    return {
        "status": "RECOVERY_EVIDENCE_CURRENT" if fresh else "BLOCKED_BACKUP_STALE_OR_CLOCK_INCONSISTENT",
        "backup_captured_at": report["backup_captured_at"],
        "verified_at": report["verified_at"],
        "max_backup_age_hours": 24,
        "backup_age_seconds": int(age.total_seconds()) if valid_order else None,
        "verified_restored_catalog_rehearsal": True,
        "backup_payload_exported": False,
        "production_write_authorized": False,
        "automatic_migration_allowed": False,
        "automatic_release_allowed": False,
        "ledger_alignment_verified": False,
        "production_rls_verified": False,
        "requires_independent_production_approval": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--as-of-utc", required=True)
    args = parser.parse_args()
    try:
        if args.report.resolve() == args.output.resolve():
            raise ValueError("Cannot overwrite recovery evidence.")
        report = json.loads(args.report.read_text(encoding="utf-8"))
        result = assess(report, now=_utc_timestamp(args.as_of_utc, "as_of_utc"))
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        print(result["status"])
        return 0 if result["status"] == "RECOVERY_EVIDENCE_CURRENT" else 1
    except (ValueError, OSError, UnicodeError) as error:
        print(f"::error::Backup preflight refused: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
