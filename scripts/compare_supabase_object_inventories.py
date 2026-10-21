#!/usr/bin/env python3
"""Compare isolated Supabase schema against production via hashed metadata.

No database connection, raw SQL definitions, student rows or migration bodies
are accepted. A report is diagnostic and never authorizes production writes.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path

KINDS = frozenset({
    "relation", "column", "constraint", "index", "routine", "policy", "trigger",
})
SHA256 = re.compile(r"^[a-f0-9]{64}$")
MAX_ROWS = 25000
MAX_ID_LENGTH = 1024
MAX_EXAMPLES = 15


@dataclass(frozen=True)
class SchemaDiff:
    status: str
    baseline_objects: int
    production_objects: int
    shared_identifiers: int
    identical_definitions: int
    different_definitions: int
    missing_in_baseline: int
    extra_in_baseline: int
    by_kind: dict[str, dict[str, int]]
    missing_in_baseline_examples: tuple[str, ...]
    extra_in_baseline_examples: tuple[str, ...]
    changed_definition_examples: tuple[str, ...]
    metadata_only: bool
    raw_definitions_exported: bool
    student_data_exported: bool
    migration_ledger_modified: bool
    production_write_authorized: bool
    remote_branch_replay_verified: bool
    complete_schema_equivalence_verified: bool


def parse_inventory(contents: str) -> dict[tuple[str, str], str]:
    """Fail closed on duplicates, malformed digests or unexpected text."""
    rows: dict[tuple[str, str], str] = {}
    for line in contents.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) != 3:
            raise ValueError("Inventory requires kind, identifier, SHA256.")
        kind, identifier, digest = parts
        if kind not in KINDS:
            raise ValueError("Unexpected inventory object type.")
        if not identifier or len(identifier) > MAX_ID_LENGTH:
            raise ValueError("Invalid object identifier.")
        if any(ord(c) < 32 or ord(c) == 127 for c in identifier):
            raise ValueError("Control characters in object identifier.")
        if not SHA256.fullmatch(digest):
            raise ValueError("Raw SQL or malformed digest in inventory.")
        key = (kind, identifier)
        if key in rows:
            raise ValueError("Duplicate schema object identity.")
        rows[key] = digest
        if len(rows) > MAX_ROWS:
            raise ValueError("Inventory exceeds reviewed bounds.")
    if not rows:
        raise ValueError("An inventory is empty.")
    return rows


def compare(
    baseline: dict[tuple[str, str], str],
    production: dict[tuple[str, str], str],
) -> SchemaDiff:
    """Object names expose what is missing; hashes reveal definition drift."""
    baseline_ids = set(baseline)
    production_ids = set(production)
    shared = baseline_ids & production_ids
    missing = production_ids - baseline_ids
    extra = baseline_ids - production_ids
    changed = {key for key in shared if baseline[key] != production[key]}
    identical = shared - changed
    by_kind: dict[str, dict[str, int]] = {}
    for kind in sorted(KINDS):
        by_kind[kind] = {
            "baseline": sum(x[0] == kind for x in baseline_ids),
            "production": sum(x[0] == kind for x in production_ids),
            "missing_in_baseline": sum(x[0] == kind for x in missing),
            "extra_in_baseline": sum(x[0] == kind for x in extra),
            "different_definitions": sum(x[0] == kind for x in changed),
        }
    aligned = not missing and not extra and not changed
    def examples(items: set[tuple[str, str]]) -> tuple[str, ...]:
        return tuple(f"{kind}:{identifier}" for kind, identifier in sorted(items)[:MAX_EXAMPLES])
    return SchemaDiff(
        status="SCHEMA_OBJECTS_ALIGNED" if aligned else "RECONSTRUCTION_GAPS_DETECTED",
        baseline_objects=len(baseline),
        production_objects=len(production),
        shared_identifiers=len(shared),
        identical_definitions=len(identical),
        different_definitions=len(changed),
        missing_in_baseline=len(missing),
        extra_in_baseline=len(extra),
        by_kind=by_kind,
        missing_in_baseline_examples=examples(missing),
        extra_in_baseline_examples=examples(extra),
        changed_definition_examples=examples(changed),
        metadata_only=True,
        raw_definitions_exported=False,
        student_data_exported=False,
        migration_ledger_modified=False,
        production_write_authorized=False,
        remote_branch_replay_verified=False,
        complete_schema_equivalence_verified=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-inventory", type=Path, required=True)
    parser.add_argument("--production-inventory", type=Path, required=True)
    parser.add_argument("--report-json", type=Path, required=True)
    args = parser.parse_args()
    try:
        target = args.report_json.resolve()
        inputs = {
            args.baseline_inventory.resolve(), args.production_inventory.resolve()
        }
        if target in inputs:
            raise ValueError("Refusing to overwrite an inventory.")
        baseline = parse_inventory(args.baseline_inventory.read_text(encoding="utf-8"))
        production = parse_inventory(args.production_inventory.read_text(encoding="utf-8"))
        report = compare(baseline, production)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(asdict(report), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except (OSError, ValueError, UnicodeError) as error:
        print(f"::error::Schema inventory rejected: {error}", file=sys.stderr)
        return 2
    print(f"Canonical schema audit: {report.status}")
    print(
        f"Missing in baseline: {report.missing_in_baseline}; "
        f"changed definitions: {report.different_definitions}; "
        f"extra in baseline: {report.extra_in_baseline}"
    )
    print("::notice::Catalog comparison cannot certify complete schema, backups or production migration.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
