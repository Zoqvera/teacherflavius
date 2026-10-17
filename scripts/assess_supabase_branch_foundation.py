#!/usr/bin/env python3
"""Classify missing foundational migrations without reading stored SQL.

The trusted CI job runs a PostgreSQL SELECT that returns only aggregate counts.
A detected CREATE TABLE is not proof of successful replay or schema identity.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

COUNT_KEYS = (
    "migration_count",
    "profiles_creates",
    "teacher_admins_creates",
    "study_lesson_pages_creates",
)
FOUNDATIONS = {
    "profiles_creates": "public.profiles",
    "teacher_admins_creates": "public.teacher_admins",
    "study_lesson_pages_creates": "public.study_lesson_pages",
}


@dataclass(frozen=True)
class FoundationAssessment:
    status: str
    migration_count: int
    undeclared_foundations: tuple[str, ...]
    metadata_only: bool
    statements_exported: bool
    dashboard_branch_replay_verified: bool
    github_branch_replay_verified: bool
    production_write_authorized: bool


def assess(raw: object) -> FoundationAssessment:
    """Return a fail-closed assessment using strictly bounded input fields."""
    if not isinstance(raw, dict) or set(raw) != set(COUNT_KEYS):
        raise ValueError("Unexpected foundation count fields.")

    count = raw["migration_count"]
    if type(count) is not int or count < 1:
        raise ValueError("The production ledger must contain migrations.")

    for key in FOUNDATIONS:
        value = raw[key]
        if type(value) is not int or not 0 <= value <= count:
            raise ValueError(f"Invalid aggregate count: {key}")

    missing = tuple(
        table for key, table in FOUNDATIONS.items()
        if raw[key] == 0
    )
    return FoundationAssessment(
        status="POSSIBLE_MISSING_FOUNDATION" if missing else "FOUNDATION_DECLARATIONS_DETECTED",
        migration_count=count,
        undeclared_foundations=missing,
        metadata_only=True,
        statements_exported=False,
        dashboard_branch_replay_verified=False,
        github_branch_replay_verified=False,
        production_write_authorized=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--counts-json", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.counts_json.resolve() == args.report_json.resolve():
            raise ValueError("The assessment cannot overwrite its input.")
        report = assess(json.loads(args.counts_json.read_text(encoding="utf-8")))
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(
            json.dumps(asdict(report), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, TypeError) as error:
        print(f"::error::Foundation preflight rejected: {error}", file=sys.stderr)
        return 2
    print(f"Dashboard branch foundation preflight: {report.status}")
    if report.undeclared_foundations:
        print("::warning::No explicit CREATE TABLE declaration was detected for "
              + ", ".join(report.undeclared_foundations))
    print("::notice::This report cannot authorize remote replay or production ledger repair.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
