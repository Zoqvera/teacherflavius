#!/usr/bin/env python3
"""Produce a read-only, reviewable Supabase migration cutover assessment.

Production input consists only of migration timestamps, names and SHA256
digests computed on the database server. Stored SQL and student records never
leave production. No migration repair, production connection or SQL write is
implemented by this module.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from scripts.analyze_supabase_migration_reconciliation import (
    Migration,
    Reconciliation,
    parse_remote_metadata,
    read_git_migrations,
    reconcile,
)
from scripts.compile_canonical_supabase_bootstrap import compile_bootstrap


@dataclass(frozen=True)
class CutoverPlan:
    status: str
    production_versions: int
    repository_versions: int
    latest_production_version: str
    latest_repository_version: str
    shared_versions: int
    changed_shared_versions: int
    missing_repository_versions: int
    unregistered_repository_versions: int
    proven_timestamp_aliases: int
    unverified_timestamp_aliases: int
    bootstrap_overlays: int
    bootstrap_sha256: str
    config_committed: bool
    synthetic_seed_committed: bool
    historical_replay_authorized: bool
    automatic_branching_authorized: bool
    production_ledger_write_authorized: bool
    complete_remote_preview_verified: bool
    blockers: tuple[str, ...]
    required_next_steps: tuple[str, ...]


def assemble_plan(
    remote: list[Migration],
    local: list[Migration],
    comparison: Reconciliation,
    *,
    bootstrap_overlays: int,
    bootstrap_sha256: str,
    config_present: bool,
    seed_present: bool,
) -> CutoverPlan:
    """Classify blockers without ever approving writes based on checksums."""
    if not remote or not local:
        raise ValueError("Both production and repository migration catalogs are required.")
    if bootstrap_overlays < 60 or len(bootstrap_sha256) != 64:
        raise ValueError("Canonical bootstrap manifest is missing or invalid.")

    blockers: list[str] = []
    if comparison.status != "METADATA_AND_SQL_ALIGNED":
        blockers.append("Production migration identity differs from the Git catalog.")
    if not config_present or not seed_present:
        blockers.append("Supabase config and synthetic seed are not both on protected main.")

    # Even perfect metadata parity cannot establish that new remote branches
    # can replay all historic application objects or isolate integrations.
    blockers.append("A full clean-schema remote branch replay has not been verified.")
    blockers.append("A reviewed, reversible production ledger cutover is not approved.")

    return CutoverPlan(
        status="BLOCKED_RECONCILIATION" if comparison.status != "METADATA_AND_SQL_ALIGNED"
        else "BLOCKED_REMOTE_VALIDATION",
        production_versions=comparison.production_versions,
        repository_versions=comparison.repository_versions,
        latest_production_version=max(item.version for item in remote),
        latest_repository_version=max(item.version for item in local),
        shared_versions=comparison.versions_in_both,
        changed_shared_versions=len(comparison.same_version_changed_sql_versions),
        missing_repository_versions=comparison.remote_versions_missing_in_git,
        unregistered_repository_versions=comparison.git_versions_not_in_remote,
        proven_timestamp_aliases=comparison.timestamp_shift_same_sql,
        unverified_timestamp_aliases=comparison.timestamp_shift_different_sql,
        bootstrap_overlays=bootstrap_overlays,
        bootstrap_sha256=bootstrap_sha256,
        config_committed=config_present,
        synthetic_seed_committed=seed_present,
        historical_replay_authorized=False,
        automatic_branching_authorized=False,
        production_ledger_write_authorized=False,
        complete_remote_preview_verified=False,
        blockers=tuple(blockers),
        required_next_steps=(
            "Keep the historic SQL files and the production migration ledger unchanged.",
            "Review timestamp aliases and changed SQL by identity; do not repair by filename.",
            "Prepare a canonical-only migration directory in a disposable checkout.",
            "Verify full schema replay, RLS, Auth, Cron isolation and synthetic workflows.",
            "Design a reversible production ledger transition for explicit approval.",
            "After approval and cost confirmation, validate a complete remote preview.",
            "Only then enable Supabase Automatic Branching and production deployment gates.",
        ),
    )


def create_plan(root: Path, metadata: str) -> CutoverPlan:
    """Compile the approved baseline and assess a metadata-only remote catalog."""
    root = root.resolve()
    remote = parse_remote_metadata(metadata)
    local = read_git_migrations(root / "supabase" / "migrations")
    comparison = reconcile(remote, local)
    _, manifest = compile_bootstrap(root)

    return assemble_plan(
        remote,
        local,
        comparison,
        bootstrap_overlays=manifest["overlay_count"],
        bootstrap_sha256=manifest["bootstrap_sha256"],
        config_present=(root / "supabase" / "config.toml").is_file(),
        seed_present=(root / "supabase" / "seed.sql").is_file(),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repository-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
    )
    parser.add_argument("--remote-metadata-file", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    args = parser.parse_args()

    try:
        plan = create_plan(
            args.repository_root,
            args.remote_metadata_file.read_text(encoding="utf-8"),
        )
        destination = args.report_json.resolve()
        migrations_dir = (args.repository_root / "supabase" / "migrations").resolve()
        if destination == migrations_dir or migrations_dir in destination.parents:
            raise ValueError("Cannot write an assessment into the migrations folder.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(
            json.dumps(asdict(plan), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, UnicodeError, ValueError) as error:
        print(f"::error::Cutover assessment rejected: {error}", file=sys.stderr)
        return 2

    print(f"Migration cutover: {plan.status}")
    print(
        f"Production: {plan.production_versions}; Git: {plan.repository_versions}; "
        f"verified canonical overlays: {plan.bootstrap_overlays}"
    )
    print("::warning::Do not enable automatic branches or modify the production migration ledger.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
