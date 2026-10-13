#!/usr/bin/env python3
"""Classify Git versus Supabase migration history without reading private SQL.

A trusted GitHub Actions job obtains only version, name and a server-side SHA256
digest of historical SQL. This module never receives the statements themselves.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

VERSION = re.compile(r"^[0-9]{14}$")
NAME = re.compile(r"^[^\t\r\n]+$")
CHECKSUM = re.compile(r"^[0-9a-f]{64}$")
MIGRATION_FILE = re.compile(r"^([0-9]{14})_(.+)\.sql$")


@dataclass(frozen=True)
class Migration:
    version: str
    name: str
    checksum: str


@dataclass(frozen=True)
class Reconciliation:
    production_versions: int
    repository_versions: int
    versions_in_both: int
    same_version_and_sql: int
    same_version_different_sql: int
    same_version_different_name: int
    remote_versions_missing_in_git: int
    git_versions_not_in_remote: int
    timestamp_shift_candidates: int
    timestamp_shift_same_sql: int
    timestamp_shift_different_sql: int
    remaining_remote_only: int
    remaining_git_only: int
    remote_only_examples: tuple[str, ...]
    git_only_examples: tuple[str, ...]
    changed_sql_examples: tuple[str, ...]
    same_version_changed_sql_versions: tuple[str, ...]
    timestamp_aliases_identical_sql: tuple[tuple[str, str], ...]
    timestamp_aliases_changed_sql: tuple[tuple[str, str], ...]
    remaining_remote_versions: tuple[str, ...]
    remaining_git_versions: tuple[str, ...]
    status: str


def validate(record: Migration) -> None:
    if not VERSION.fullmatch(record.version):
        raise ValueError("Invalid migration version; expected YYYYMMDDHHMMSS.")
    if not NAME.fullmatch(record.name) or not record.name.strip():
        raise ValueError("Invalid migration name; SQL statements must never be supplied.")
    if not CHECKSUM.fullmatch(record.checksum):
        raise ValueError("Invalid SQL SHA256 digest.")


def parse_remote_metadata(text: str) -> list[Migration]:
    migrations: list[Migration] = []
    for line in text.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            raise ValueError("Remote metadata must be version, name, SHA256 only.")
        record = Migration(*parts)
        validate(record)
        migrations.append(record)
    if not migrations:
        raise ValueError("The production migration ledger is empty.")
    if len({item.version for item in migrations}) != len(migrations):
        raise ValueError("Duplicate version in production metadata.")
    return migrations


def read_git_migrations(directory: Path) -> list[Migration]:
    if not directory.is_dir():
        raise ValueError("supabase/migrations does not exist.")
    migrations: list[Migration] = []
    for file in sorted(directory.glob("*.sql")):
        match = MIGRATION_FILE.fullmatch(file.name)
        if match is None:
            raise ValueError("Invalid local migration filename.")
        contents = file.read_text(encoding="utf-8").strip()
        digest = hashlib.sha256(contents.encode("utf-8")).hexdigest()
        record = Migration(match.group(1), match.group(2), digest)
        validate(record)
        migrations.append(record)
    if len({item.version for item in migrations}) != len(migrations):
        raise ValueError("Duplicate Git migration version.")
    return migrations


def reconcile(production: list[Migration], repository: list[Migration]) -> Reconciliation:
    """Separate timestamp aliases from proven byte-identical SQL."""
    remote_by_version = {item.version: item for item in production}
    git_by_version = {item.version: item for item in repository}
    shared = sorted(set(remote_by_version) & set(git_by_version))
    remote_only = [item for item in production if item.version not in git_by_version]
    git_only = [item for item in repository if item.version not in remote_by_version]

    names = Counter(item.name for item in remote_only)
    rem_by_name = {item.name: item for item in remote_only if names[item.name] == 1}
    timestamp_candidates = [
        (item, rem_by_name[item.name])
        for item in git_only
        if item.name in rem_by_name
    ]
    matched_remote_versions = {remote.version for _, remote in timestamp_candidates}
    matched_git_versions = {git.version for git, _ in timestamp_candidates}
    same_sql = sum(git.checksum == remote.checksum for git, remote in timestamp_candidates)
    changed_versions = [
        version for version in shared
        if remote_by_version[version].checksum != git_by_version[version].checksum
        or remote_by_version[version].name != git_by_version[version].name
    ]
    unchanged = sum(
        remote_by_version[version] == git_by_version[version]
        for version in shared
    )
    name_different = sum(
        remote_by_version[version].name != git_by_version[version].name
        for version in shared
    )
    sql_different = sum(
        remote_by_version[version].checksum != git_by_version[version].checksum
        for version in shared
    )

    aligned = (
        len(production) == len(repository) == len(shared)
        and unchanged == len(shared)
    )
    return Reconciliation(
        production_versions=len(production),
        repository_versions=len(repository),
        versions_in_both=len(shared),
        same_version_and_sql=unchanged,
        same_version_different_sql=sql_different,
        same_version_different_name=name_different,
        remote_versions_missing_in_git=len(remote_only),
        git_versions_not_in_remote=len(git_only),
        timestamp_shift_candidates=len(timestamp_candidates),
        timestamp_shift_same_sql=same_sql,
        timestamp_shift_different_sql=len(timestamp_candidates) - same_sql,
        remaining_remote_only=len(remote_only) - len(matched_remote_versions),
        remaining_git_only=len(git_only) - len(matched_git_versions),
        remote_only_examples=tuple(
            sorted(item.version for item in remote_only if item.version not in matched_remote_versions)[:8]
        ),
        git_only_examples=tuple(
            sorted(item.version for item in git_only if item.version not in matched_git_versions)[:8]
        ),
        changed_sql_examples=tuple(changed_versions[:8]),
        same_version_changed_sql_versions=tuple(changed_versions),
        timestamp_aliases_identical_sql=tuple(
            sorted((git.version, remote.version)
                   for git, remote in timestamp_candidates
                   if git.checksum == remote.checksum)
        ),
        timestamp_aliases_changed_sql=tuple(
            sorted((git.version, remote.version)
                   for git, remote in timestamp_candidates
                   if git.checksum != remote.checksum)
        ),
        remaining_remote_versions=tuple(
            sorted(item.version for item in remote_only
                   if item.version not in matched_remote_versions)
        ),
        remaining_git_versions=tuple(
            sorted(item.version for item in git_only
                   if item.version not in matched_git_versions)
        ),
        status="METADATA_AND_SQL_ALIGNED" if aligned else "RECONCILIATION_REQUIRED",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--remote-metadata-file", type=Path, required=True)
    parser.add_argument(
        "--migrations-dir", type=Path,
        default=Path(__file__).resolve().parents[1] / "supabase" / "migrations",
    )
    parser.add_argument("--report-json", type=Path)
    args = parser.parse_args()

    try:
        prod = parse_remote_metadata(args.remote_metadata_file.read_text(encoding="utf-8"))
        git = read_git_migrations(args.migrations_dir)
        result = reconcile(prod, git)
    except (OSError, UnicodeError, ValueError) as error:
        print(f"::error::Reconciliation metadata rejected: {error}", file=sys.stderr)
        return 2

    report = json.dumps(asdict(result), indent=2, ensure_ascii=False) + "\n"
    if args.report_json:
        args.report_json.parent.mkdir(parents=True, exist_ok=True)
        args.report_json.write_text(report, encoding="utf-8")
    print(report)

    if result.status != "METADATA_AND_SQL_ALIGNED":
        print("::warning::Do not replay historical migrations or repair production migration IDs automatically.")
        print("::warning::Identical names alone do not prove that migration bodies are identical.")
    else:
        print("Metadata matches. An independent clean-room database rebuild is still mandatory.")

    # Diagnostic workflow reports unresolved drift without masking implementation
    # errors as failed infrastructure. Readiness remains blocked by its own gate.
    return 0


if __name__ == "__main__":
    sys.exit(main())
