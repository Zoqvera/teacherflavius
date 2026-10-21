#!/usr/bin/env python3
"""Check lesson presentation migration prerequisites without granting deployment.

Input is one read-only JSON aggregate from the PostgreSQL catalog.
This tool never connects to production, changes a ledger, or authorizes DDL.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

FLAGS = (
    "stage1_migration_registered",
    "stage3_migration_registered",
    "presentations_table_exists",
    "versions_table_exists",
    "views_table_exists",
    "profiles_table_exists",
    "lesson_pages_table_exists",
    "teacher_admin_helper_exists",
    "production_data_examined",
    "production_write_authorized",
)

EXPECTED_VERSIONS = ("20261017133000", "20261017144500")


def assess(snapshot: dict[str, object]) -> dict[str, object]:
    if not isinstance(snapshot, dict):
        raise ValueError("Expected one JSON object.")
    expected = {*FLAGS, "ledger_count", "ledger_tip"}
    if set(snapshot) != expected:
        raise ValueError("Unexpected keys in metadata-only inventory.")
    if not isinstance(snapshot["ledger_count"], int) or isinstance(
        snapshot["ledger_count"], bool
    ) or snapshot["ledger_count"] < 0:
        raise ValueError("Invalid migration count.")
    tip = snapshot["ledger_tip"]
    if tip is not None and (
        not isinstance(tip, str) or re.fullmatch(r"\d{14}", tip) is None
    ):
        raise ValueError("Invalid production ledger tip.")
    if any(type(snapshot[name]) is not bool for name in FLAGS):
        raise ValueError("Every safety flag must be boolean.")
    if snapshot["production_data_examined"] or snapshot["production_write_authorized"]:
        raise ValueError("Read-only preflight boundaries were violated.")

    missing_prerequisites = [
        name for name in (
            "profiles_table_exists",
            "lesson_pages_table_exists",
            "teacher_admin_helper_exists",
        ) if not snapshot[name]
    ]
    stage_one = snapshot["stage1_migration_registered"]
    stage_three = snapshot["stage3_migration_registered"]
    tables = [
        snapshot["presentations_table_exists"],
        snapshot["versions_table_exists"],
        snapshot["views_table_exists"],
    ]
    any_registered_or_created = stage_one or stage_three or any(tables)
    all_registered_and_created = stage_one and stage_three and all(tables)

    if missing_prerequisites:
        status = "BLOCKED_MISSING_PREREQUISITES"
    elif all_registered_and_created:
        status = "POST_DEPLOYMENT_SECURITY_REVIEW_REQUIRED"
    elif any_registered_or_created:
        status = "BLOCKED_PARTIAL_OR_INCONSISTENT_DEPLOYMENT"
    else:
        status = "BLOCKED_PENDING_LEDGER_RECONCILIATION"

    return {
        "status": status,
        "migration_versions": list(EXPECTED_VERSIONS),
        "ledger_count": snapshot["ledger_count"],
        "ledger_tip": tip,
        "missing_prerequisites": missing_prerequisites,
        "metadata_only": True,
        "production_write_authorized": False,
        "automatic_migration_allowed": False,
        "automatic_release_allowed": False,
        "full_ledger_reconciliation_verified": False,
        "application_rls_verified_in_production": False,
        "rollout_gates_enabled": False,
        "note": (
            "Even a complete catalog is not approval to release. Independently "
            "verify ledger hashes, privileges, RLS, backup and rollback controls."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.input.resolve() == args.output.resolve():
            raise ValueError("Input and report must be separate files.")
        data = json.loads(args.input.read_text(encoding="utf-8"))
        result = assess(data)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(result, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
        print(result["status"])
        return 0
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError) as error:
        print(f"::error::Presentation preflight refused: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
