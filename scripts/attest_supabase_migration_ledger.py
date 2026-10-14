#!/usr/bin/env python3
"""Produce an immutable-style fingerprint of migration history metadata.

The input is version, name and SHA256 computed inside PostgreSQL.
No SQL statements, customer data, or database credentials are accepted.
This tool never performs a production database write.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from scripts.analyze_supabase_migration_reconciliation import (
    Migration,
    parse_remote_metadata,
)


@dataclass(frozen=True)
class LedgerAttestation:
    status: str
    entries: int
    first_version: str
    last_version: str
    metadata_sha256: str
    baseline_metadata_sha256: str
    matches_baseline: bool
    restores_full_migration_sql: bool
    production_write_authorized: bool


def metadata_fingerprint(records: list[Migration]) -> str:
    """Hash the *full* ordered ledger identity without emitting SQL or names."""
    canonical = "".join(
        f"{item.version}\t{item.name}\t{item.checksum}\n"
        for item in sorted(records, key=lambda record: record.version)
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def attest(baseline: list[Migration], observed: list[Migration] | None) -> LedgerAttestation:
    """An absent second snapshot means reference-only, not successful rollback."""
    if not baseline:
        raise ValueError("A complete ledger snapshot is required.")
    original = metadata_fingerprint(baseline)
    comparison = metadata_fingerprint(observed) if observed is not None else ""
    unchanged = observed is not None and len(baseline) == len(observed) and original == comparison
    return LedgerAttestation(
        status=("UNVERIFIED_REFERENCE" if observed is None
                else "LEDGER_UNCHANGED" if unchanged else "LEDGER_DRIFT_DETECTED"),
        entries=len(baseline),
        first_version=min(item.version for item in baseline),
        last_version=max(item.version for item in baseline),
        metadata_sha256=comparison if observed is not None else original,
        baseline_metadata_sha256=original,
        matches_baseline=unchanged,
        restores_full_migration_sql=False,
        production_write_authorized=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-metadata-file", type=Path, required=True)
    parser.add_argument("--observed-metadata-file", type=Path)
    parser.add_argument("--report-json", type=Path, required=True)
    args = parser.parse_args()

    try:
        baseline = parse_remote_metadata(
            args.baseline_metadata_file.read_text(encoding="utf-8")
        )
        observed = (
            parse_remote_metadata(args.observed_metadata_file.read_text(encoding="utf-8"))
            if args.observed_metadata_file is not None else None
        )
        target = args.report_json.resolve()
        if "supabase/migrations" in target.as_posix():
            raise ValueError("Cannot save an attestation in the production migrations folder.")
        result = attest(baseline, observed)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(
            json.dumps(asdict(result), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, UnicodeError, ValueError) as exc:
        print(f"::error::Ledger attestation rejected: {exc}", file=sys.stderr)
        return 2

    print(
        f"Migration ledger: {result.status} "
        f"({result.entries} versions; newest {result.last_version})"
    )
    print("::warning::A metadata digest is not a full SQL backup or a PITR restore.")
    return 1 if result.status == "LEDGER_DRIFT_DETECTED" else 0


if __name__ == "__main__":
    raise SystemExit(main())
