#!/usr/bin/env python3
"""Read-only, metadata-only preflight for Supabase automatic branching.

Never connects to production itself. The caller supplies version identifiers
retrieved using a read-only query; migration SQL and customer records are not
loaded or printed.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

VERSION_PATTERN = re.compile(r"^[0-9]{14}$")
MIGRATION_PATTERN = re.compile(r"^(?P<version>[0-9]{14})_(?P<name>[^/]+)\.sql$")


@dataclass(frozen=True)
class ReadinessReport:
    status: str
    production_versions: int
    repository_migrations: int
    shared_versions: int
    missing_from_repository: int
    unregistered_in_production: int
    duplicate_versions: tuple[str, ...]
    invalid_migration_names: tuple[str, ...]
    missing_from_repository_sample: tuple[str, ...]
    unregistered_in_production_sample: tuple[str, ...]
    missing_branching_config: bool
    missing_synthetic_seed: bool
    reason: str


def parse_local_versions(migrations_directory: Path) -> tuple[set[str], tuple[str, ...], tuple[str, ...]]:
    """Return unique local versions and disallow ambiguous or malformed filenames."""
    if not migrations_directory.is_dir():
        return set(), (), ("supabase/migrations directory missing",)

    versions: list[str] = []
    invalid_names: list[str] = []
    for migration in sorted(migrations_directory.glob("*.sql")):
        match = MIGRATION_PATTERN.fullmatch(migration.name)
        if match is None:
            invalid_names.append(migration.name)
            continue
        versions.append(match.group("version"))
    duplicates = tuple(sorted({version for version in versions if versions.count(version) > 1}))
    return set(versions), duplicates, tuple(invalid_names)


def parse_production_versions(source: str) -> set[str]:
    """Only accept version identifiers, never SQL statements or user data."""
    versions = set()
    for line in source.splitlines():
        version = line.strip()
        if not version:
            continue
        if VERSION_PATTERN.fullmatch(version) is None:
            raise ValueError("Invalid migration version supplied; expected 14 digits per line.")
        versions.add(version)
    if not versions:
        raise ValueError("Missing production migration versions; cannot certify readiness.")
    return versions


def evaluate_readiness(
    repository_root: Path,
    production_versions: set[str],
) -> ReadinessReport:
    """Conservatively reject previews unless every tracked migration is aligned."""
    supabase_dir = repository_root / "supabase"
    local, duplicate, invalid = parse_local_versions(supabase_dir / "migrations")
    missing = sorted(production_versions - local)
    unregistered = sorted(local - production_versions)
    config_missing = not (supabase_dir / "config.toml").is_file()
    seed_missing = not (supabase_dir / "seed.sql").is_file()
    blockers = bool(missing or unregistered or duplicate or invalid or config_missing or seed_missing)
    return ReadinessReport(
        status="BLOCKED" if blockers else "METADATA_ALIGNED",
        production_versions=len(production_versions),
        repository_migrations=len(local),
        shared_versions=len(local & production_versions),
        missing_from_repository=len(missing),
        unregistered_in_production=len(unregistered),
        duplicate_versions=duplicate,
        invalid_migration_names=invalid,
        missing_from_repository_sample=tuple(missing[:8]),
        unregistered_in_production_sample=tuple(unregistered[:8]),
        missing_branching_config=config_missing,
        missing_synthetic_seed=seed_missing,
        reason=(
            "Migration history and preview bootstrap are not aligned."
            if blockers
            else "Only metadata aligned. A clean database migration replay, synthetic-data "
                 "integration tests and secret isolation are still mandatory."
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--production-versions-file", type=Path, required=True)
    parser.add_argument("--report-json", type=Path)
    args = parser.parse_args()
    try:
        production = parse_production_versions(
            args.production_versions_file.read_text(encoding="utf-8")
        )
    except (OSError, ValueError) as error:
        print(f"::error::Branch readiness assessment failed: {error}", file=sys.stderr)
        return 2

    report = evaluate_readiness(args.repository_root, production)
    serialized = json.dumps(asdict(report), indent=2, ensure_ascii=False) + "\n"
    if args.report_json is not None:
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(serialized, encoding="utf-8")

    print("Supabase branching readiness (migration metadata only)")
    print(f"  Production versions: {report.production_versions}")
    print(f"  Repository versions: {report.repository_migrations}")
    print(f"  Matching versions:   {report.shared_versions}")
    print(f"  Missing in Git:      {report.missing_from_repository}")
    print(f"  Unregistered in DB:  {report.unregistered_in_production}")
    print(f"  Branching config missing: {report.missing_branching_config}")
    print(f"  Synthetic seed missing:   {report.missing_synthetic_seed}")
    print(f"  Result: {report.status}")
    if report.status == "BLOCKED":
        print("::error::Do not enable automatic Supabase branching until blockers are resolved.")
    else:
        print("Metadata matches, but do not enable automatic branches until a full clean replay passes.")
    return 1 if report.status == "BLOCKED" else 0


if __name__ == "__main__":
    sys.exit(main())
