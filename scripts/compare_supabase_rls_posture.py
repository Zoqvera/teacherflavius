#!/usr/bin/env python3
"""Compare row-security policy posture without exporting policy expressions.

This is a fail-closed diagnostic; matching metadata does not establish
authorization equivalence and never authorizes production changes.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

DIGEST = re.compile(r"^[0-9a-f]{64}$")
ROLE_LIST = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_,]*$")
COMMANDS = frozenset({"SELECT", "INSERT", "UPDATE", "DELETE", "ALL"})
PERMISSIVE = frozenset({"PERMISSIVE", "RESTRICTIVE"})
MAX_POLICIES = 5000
MAX_NAME = 1024
MAX_EXAMPLES = 12


@dataclass(frozen=True)
class PolicyPosture:
    command: str
    permissive: str
    roles: tuple[str, ...]
    using_hash: str
    check_hash: str


@dataclass(frozen=True)
class PolicyComparison:
    status: str
    baseline_policies: int
    production_policies: int
    absent_in_baseline: int
    extra_in_baseline: int
    changed_role_or_command: int
    changed_predicates_only: int
    matching_policies: int
    potential_baseline_role_broadening: int
    missing_examples: tuple[str, ...]
    privilege_difference_examples: tuple[str, ...]
    predicate_difference_examples: tuple[str, ...]
    potential_broadening_examples: tuple[str, ...]
    expressions_exported: bool
    student_data_exported: bool
    production_write_authorized: bool
    security_equivalence_verified: bool
    remote_branch_replay_verified: bool


def parse_inventory(contents: str) -> dict[str, PolicyPosture]:
    """Accept only six bounded metadata fields and digest-only predicates."""
    parsed: dict[str, PolicyPosture] = {}
    for line in contents.splitlines():
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) != 6:
            raise ValueError("Invalid policy inventory column count.")
        name, command, permissive, raw_roles, using_hash, check_hash = parts
        if not name or len(name) > MAX_NAME or any(ord(c) < 32 or ord(c) == 127 for c in name):
            raise ValueError("Invalid policy identifier.")
        if command not in COMMANDS or permissive not in PERMISSIVE:
            raise ValueError("Unknown policy mode.")
        if not ROLE_LIST.fullmatch(raw_roles):
            raise ValueError("Invalid policy role list.")
        if not DIGEST.fullmatch(using_hash) or not DIGEST.fullmatch(check_hash):
            raise ValueError("Raw policy expression or invalid hash encountered.")
        roles = tuple(raw_roles.split(","))
        if len(roles) != len(set(roles)):
            raise ValueError("Duplicate role in policy declaration.")
        if name in parsed:
            raise ValueError("Duplicate policy identifier.")
        parsed[name] = PolicyPosture(command, permissive, roles, using_hash, check_hash)
        if len(parsed) > MAX_POLICIES:
            raise ValueError("Policy inventory exceeds bounds.")
    if not parsed:
        raise ValueError("Policy inventory is empty.")
    return parsed


def compare_policies(
    baseline: dict[str, PolicyPosture],
    production: dict[str, PolicyPosture],
) -> PolicyComparison:
    baseline_ids, production_ids = set(baseline), set(production)
    common = baseline_ids & production_ids
    missing, extra = production_ids - baseline_ids, baseline_ids - production_ids
    changed_permissions: set[str] = set()
    changed_predicates: set[str] = set()
    potential_broadening: set[str] = set()

    for name in common:
        left, right = baseline[name], production[name]
        privilege_changed = (
            left.command != right.command
            or left.permissive != right.permissive
            or set(left.roles) != set(right.roles)
        )
        predicate_changed = (
            left.using_hash != right.using_hash
            or left.check_hash != right.check_hash
        )
        if privilege_changed:
            changed_permissions.add(name)
            if (
                ("public" in left.roles and "public" not in right.roles)
                or set(left.roles) > set(right.roles)
                or (left.command == "ALL" and right.command != "ALL")
                or (left.permissive == "PERMISSIVE" and right.permissive == "RESTRICTIVE")
            ):
                potential_broadening.add(name)
        elif predicate_changed:
            changed_predicates.add(name)

    def examples(values: set[str]) -> tuple[str, ...]:
        return tuple(sorted(values)[:MAX_EXAMPLES])

    return PolicyComparison(
        status="POLICY_POSTURE_DIFFERENCES" if (missing or extra or changed_permissions or changed_predicates)
        else "POLICY_POSTURE_METADATA_MATCH",
        baseline_policies=len(baseline),
        production_policies=len(production),
        absent_in_baseline=len(missing),
        extra_in_baseline=len(extra),
        changed_role_or_command=len(changed_permissions),
        changed_predicates_only=len(changed_predicates),
        matching_policies=len(common - changed_permissions - changed_predicates),
        potential_baseline_role_broadening=len(potential_broadening),
        missing_examples=examples(missing),
        privilege_difference_examples=examples(changed_permissions),
        predicate_difference_examples=examples(changed_predicates),
        potential_broadening_examples=examples(potential_broadening),
        expressions_exported=False,
        student_data_exported=False,
        production_write_authorized=False,
        security_equivalence_verified=False,
        remote_branch_replay_verified=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", type=Path, required=True)
    parser.add_argument("--production", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        target = args.output.resolve()
        if target in (args.baseline.resolve(), args.production.resolve()):
            raise ValueError("Report would overwrite an input.")
        report = compare_policies(
            parse_inventory(args.baseline.read_text(encoding="utf-8")),
            parse_inventory(args.production.read_text(encoding="utf-8")),
        )
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(asdict(report), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, UnicodeError) as exc:
        print(f"::error::Policy posture audit rejected: {exc}", file=sys.stderr)
        return 2
    print(f"RLS policy posture: {report.status}")
    print(
        f"Missing={report.absent_in_baseline}, extra={report.extra_in_baseline}, "
        f"privileges={report.changed_role_or_command}, "
        f"predicates_only={report.changed_predicates_only}, "
        f"possible_broadening={report.potential_baseline_role_broadening}"
    )
    print("::notice::Differences require human-readable private review; no policy updates were made.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
