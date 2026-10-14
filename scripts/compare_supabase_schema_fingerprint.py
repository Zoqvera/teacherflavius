#!/usr/bin/env python3
"""Compare read-only Supabase catalog counts to the reviewed reconstruction.

This diagnostic is deliberately not a schema-equivalence or backup attestation.
It neither connects to a database nor exposes application records.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

METRICS = (
    "tables",
    "constraints",
    "non_constraint_indexes",
    "public_functions",
    "private_functions",
    "rls_policies",
    "public_user_triggers",
    "application_auth_triggers",
    "application_event_triggers",
    "cron_jobs",
    "storage_buckets",
    "vault_secret_names",
)


@dataclass(frozen=True)
class MetricDifference:
    baseline: int
    production: int
    delta: int


@dataclass(frozen=True)
class SchemaComparison:
    status: str
    baseline_reference_version: str
    changed_metric_count: int
    differences: dict[str, MetricDifference]
    metadata_only: bool
    verifies_full_schema_equivalence: bool
    verifies_backup_recoverability: bool
    production_write_authorized: bool


def validated_counts(value: object, *, baseline: bool) -> dict[str, int]:
    """Fail closed for missing, unknown or invalid metadata fields."""
    if not isinstance(value, dict):
        raise ValueError("Schema fingerprint must be a JSON object.")
    optional = {"captured_from_migration_version"} if baseline else set()
    unexpected = set(value) - set(METRICS) - optional
    missing = set(METRICS) - set(value)
    if unexpected or missing:
        raise ValueError(
            f"Schema fingerprint fields are invalid: missing={sorted(missing)}, "
            f"unexpected={sorted(unexpected)}."
        )
    for metric in METRICS:
        number = value[metric]
        if type(number) is not int or number < 0:
            raise ValueError(f"Metric {metric} must be a non-negative integer.")
    if baseline:
        version = value.get("captured_from_migration_version")
        if not isinstance(version, str) or len(version) != 14 or not version.isdecimal():
            raise ValueError("Baseline reference version must have 14 digits.")
    return {metric: value[metric] for metric in METRICS}


def compare(baseline: object, production: object) -> SchemaComparison:
    expected = validated_counts(baseline, baseline=True)
    observed = validated_counts(production, baseline=False)
    differences = {
        metric: MetricDifference(
            baseline=expected[metric],
            production=observed[metric],
            delta=observed[metric] - expected[metric],
        )
        for metric in METRICS
        if expected[metric] != observed[metric]
    }
    return SchemaComparison(
        status="SCHEMA_DRIFT_DETECTED" if differences else "SCHEMA_COUNTS_ALIGNED",
        baseline_reference_version=baseline["captured_from_migration_version"],
        changed_metric_count=len(differences),
        differences=differences,
        metadata_only=True,
        verifies_full_schema_equivalence=False,
        verifies_backup_recoverability=False,
        production_write_authorized=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-json", type=Path, required=True)
    parser.add_argument("--production-json", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    args = parser.parse_args()

    try:
        baseline = json.loads(args.baseline_json.read_text(encoding="utf-8"))
        production = json.loads(args.production_json.read_text(encoding="utf-8"))
        report = compare(baseline, production)
        if args.report_json.resolve() in {
            args.baseline_json.resolve(),
            args.production_json.resolve(),
        }:
            raise ValueError("Cannot overwrite a schema fingerprint input.")
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(
            json.dumps(asdict(report), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, TypeError) as error:
        print(f"::error::Invalid schema comparison: {error}", file=sys.stderr)
        return 2

    print(f"Schema catalog comparison: {report.status}")
    for key, difference in report.differences.items():
        print(
            f"::warning::{key}: baseline={difference.baseline}, "
            f"production={difference.production} (delta={difference.delta:+d})"
        )
    print("::notice::Catalog counts alone do not certify migrations or backups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
