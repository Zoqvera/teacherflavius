#!/usr/bin/env python3
"""Audit a canonical Supabase CLI replay bundle without touching production.

The bundle must be generated outside the repository by
scripts.prepare_supabase_cli_replay. Only versions, hashes and safety signals
are emitted; no historical SQL statements, credentials or customer rows.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from scripts.compile_canonical_supabase_bootstrap import FRESH_DATABASE_GUARD
from scripts.prepare_supabase_cli_replay import (
    ASSERTION_FILENAME,
    ASSERTION_VERSION,
    BOOTSTRAP_FILENAME,
    BOOTSTRAP_VERSION,
    STOP_CRON,
    VERIFY_SCHEMA,
    assert_safe_paths,
)


@dataclass(frozen=True)
class CanonicalChainAudit:
    status: str
    reviewed_overlays: int
    bootstrap_sha256: str
    staged_migration_versions: tuple[str, ...]
    migration_sha256: tuple[str, ...]
    seed_sha256: str
    historical_migrations_replayed: bool
    production_ledger_modified: bool
    remote_preview_verified: bool
    automatic_branching_safe: bool


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def check_chain(repository_root: Path, staging_root: Path) -> CanonicalChainAudit:
    """Verify the temporary chain is exactly the approved canonical baseline."""
    assert_safe_paths(repository_root, staging_root)
    directory = staging_root.resolve()
    migrations_dir = directory / "supabase" / "migrations"
    filenames = sorted(path.name for path in migrations_dir.glob("*.sql"))
    if filenames != [BOOTSTRAP_FILENAME, ASSERTION_FILENAME]:
        raise ValueError("Unexpected staged migration set; historical SQL must not be replayed.")

    artifact_dir = directory / "artifacts"
    manifest = json.loads((artifact_dir / "manifest.json").read_text(encoding="utf-8"))
    compiled = (artifact_dir / "compiled.sql").read_text(encoding="utf-8")
    bootstrap = (migrations_dir / BOOTSTRAP_FILENAME).read_text(encoding="utf-8")
    assertion = (migrations_dir / ASSERTION_FILENAME).read_text(encoding="utf-8")
    seed = (directory / "supabase" / "seed.sql").read_text(encoding="utf-8")

    if manifest.get("mode") != "disposable-only":
        raise ValueError("Unapproved canonical bootstrap mode.")
    if manifest.get("overlay_count", 0) < 60:
        raise ValueError("Insufficient reviewed reconstruction overlays.")
    if sha256(compiled) != manifest.get("bootstrap_sha256"):
        raise ValueError("Canonical bootstrap hash differs from reviewed manifest.")
    if bootstrap != compiled + STOP_CRON or assertion != VERIFY_SCHEMA:
        raise ValueError("Staged migrations differ from approved canonical SQL.")

    guard = FRESH_DATABASE_GUARD.strip()
    if guard not in bootstrap:
        raise ValueError("Canonical SQL is missing the existing-database guard.")
    if bootstrap.index(guard) > bootstrap.lower().find("create table public.profiles"):
        raise ValueError("Existing-database guard must execute before schema creation.")

    lowered_seed = seed.lower()
    if not all(word in lowered_seed for word in ("970001", "970002", "quintet", "individual")):
        raise ValueError("Expected only synthetic classes in seed.")
    if any(
        forbidden in lowered_seed
        for forbidden in (
            "insert into public.profiles",
            "insert into public.monthly_tuition",
            "insert into auth.users",
            "teacherflavius.com",
        )
    ):
        raise ValueError("Seed appears to contain real account or payment operations.")

    return CanonicalChainAudit(
        status="LOCAL_CHAIN_VALIDATED",
        reviewed_overlays=manifest["overlay_count"],
        bootstrap_sha256=manifest["bootstrap_sha256"],
        staged_migration_versions=(BOOTSTRAP_VERSION, ASSERTION_VERSION),
        migration_sha256=(sha256(bootstrap), sha256(assertion)),
        seed_sha256=sha256(seed),
        historical_migrations_replayed=False,
        production_ledger_modified=False,
        remote_preview_verified=False,
        automatic_branching_safe=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository-root", type=Path, required=True)
    parser.add_argument("--staging-root", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    args = parser.parse_args()

    try:
        report_path = args.report_json.resolve()
        migrations = (args.repository_root.resolve() / "supabase" / "migrations")
        if report_path == migrations or migrations in report_path.parents:
            raise ValueError("The report must not modify the production migrations directory.")
        audit = check_chain(args.repository_root, args.staging_root)
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(
            json.dumps(asdict(audit), indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"::error::Unsafe canonical chain: {error}", file=sys.stderr)
        return 2

    print(
        f"Validated {len(audit.staged_migration_versions)} isolated migrations "
        f"from {audit.reviewed_overlays} reviewed overlays."
    )
    print("Remote preview and production ledger transition remain BLOCKED.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
