#!/usr/bin/env python3
"""Classify absent Supabase policies by whether the target relation was restored.

Consume ONLY catalog identifiers and hashes from the protected job. Do not
retrieve SQL definitions, grant privileges or execute SQL on production.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from scripts.compare_supabase_object_inventories import parse_inventory as parse_objects
from scripts.compare_supabase_rls_posture import parse_inventory as parse_policies

MAX_TABLES_IN_REPORT = 40


@dataclass(frozen=True)
class MissingPolicyDependencyReport:
    status: str
    missing_policies: int
    missing_on_restored_relations: int
    missing_on_absent_relations: int
    table_dependencies: dict[str, dict[str, int | bool]]
    contains_predicates: bool
    contains_student_records: bool
    production_write_authorized: bool
    security_equivalence_verified: bool


def group_missing_policies(
    baseline_policies: dict,
    production_policies: dict,
    baseline_objects: dict,
) -> MissingPolicyDependencyReport:
    """Count absent policies and detect missing relations, without changing ACLs."""
    absent_names = set(production_policies) - set(baseline_policies)
    restored_names = {
        identifier for kind, identifier in baseline_objects
        if kind == "relation"
    }
    by_relation: dict[str, dict[str, int | bool]] = {}
    for qualified_name in sorted(absent_names):
        parts = qualified_name.split(".", 2)
        if len(parts) != 3 or not all(parts):
            raise ValueError("Invalid policy identity; expected schema.table.policy")
        schema, table, _ = parts
        key = f"{schema}.{table}"
        if key not in by_relation:
            by_relation[key] = {
                "absent_policies": 0,
                "relation_restored": key in restored_names,
            }
        by_relation[key]["absent_policies"] += 1

    if len(by_relation) > MAX_TABLES_IN_REPORT:
        raise ValueError("Unexpected number of missing policy tables.")

    missing_relation_count = sum(
        int(status["absent_policies"])
        for status in by_relation.values()
        if not status["relation_restored"]
    )
    restored_relation_count = len(absent_names) - missing_relation_count
    return MissingPolicyDependencyReport(
        status="POLICY_DEPENDENCIES_INCOMPLETE" if absent_names else "POLICY_IDENTITIES_COMPLETE",
        missing_policies=len(absent_names),
        missing_on_restored_relations=restored_relation_count,
        missing_on_absent_relations=missing_relation_count,
        table_dependencies=by_relation,
        contains_predicates=False,
        contains_student_records=False,
        production_write_authorized=False,
        security_equivalence_verified=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline-policies", type=Path, required=True)
    parser.add_argument("--production-policies", type=Path, required=True)
    parser.add_argument("--baseline-objects", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        path = args.output.resolve()
        inputs = {
            args.baseline_policies.resolve(),
            args.production_policies.resolve(),
            args.baseline_objects.resolve(),
        }
        if path in inputs:
            raise ValueError("Cannot overwrite a source inventory.")
        report = group_missing_policies(
            parse_policies(args.baseline_policies.read_text(encoding="utf-8")),
            parse_policies(args.production_policies.read_text(encoding="utf-8")),
            parse_objects(args.baseline_objects.read_text(encoding="utf-8")),
        )
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, UnicodeError) as exc:
        print(f"::error::Missing policy dependency inventory rejected: {exc}", file=sys.stderr)
        return 2
    print(
        "Missing policy dependencies: "
        f"{report.missing_policies} total; "
        f"{report.missing_on_absent_relations} blocked by absent relations; "
        f"{report.missing_on_restored_relations} eligible for separate review."
    )
    print("::notice::Policy dependency status cannot authorize RLS or DDL writes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
