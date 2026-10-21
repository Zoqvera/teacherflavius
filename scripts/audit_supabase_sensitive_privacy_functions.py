#!/usr/bin/env python3
"""Audit sensitive Supabase RPC privileges from read-only catalog metadata.

This report does not attest MFA enforcement, function correctness or schema
equivalence. Never export function definitions, credentials or student data.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

SERVICE_ONLY = frozenset({
    "close_student_account_for_privacy",
    "complete_account_deletion_request__mfa_inner",
    "complete_data_subject_request__mfa_inner",
    "get_data_retention_dashboard__mfa_inner",
    "get_external_data_processor_dashboard__mfa_inner",
    "mark_account_deletion_in_review__mfa_inner",
    "mark_data_subject_request_in_review__mfa_inner",
    "perform_data_retention_maintenance",
    "review_external_data_processor__mfa_inner",
    "run_data_retention_maintenance_now__mfa_inner",
})
AUTHENTICATED_WRAPPERS = frozenset({
    "cancel_my_account_deletion_request",
    "cancel_my_data_subject_request",
    "complete_account_deletion_request",
    "complete_data_subject_request",
    "create_data_subject_request",
    "delete_teacher_student",
    "get_data_retention_dashboard",
    "get_external_data_processor_dashboard",
    "get_my_data_export",
    "mark_account_deletion_in_review",
    "mark_data_subject_request_in_review",
    "request_account_deletion",
    "review_external_data_processor",
    "run_data_retention_maintenance_now",
})
EXPECTED = SERVICE_ONLY | AUTHENTICATED_WRAPPERS
MAX_ROWS = 64
SIGNATURE = re.compile(r"(?:public\.)?([a-z][a-z0-9_]*)\([^\t\r\n]*\)\Z")


@dataclass(frozen=True)
class FunctionPrivilege:
    name: str
    security_definer: bool
    anon_execute: bool
    authenticated_execute: bool
    service_execute: bool
    explicit_search_path: bool
    mentions_aal2: bool
    references_admin_mfa_alias: bool


@dataclass(frozen=True)
class PrivacyFunctionAssessment:
    status: str
    inspected_functions: int
    authenticated_wrappers: int
    service_only_functions: int
    anon_exposed: int
    missing_search_path: int
    missing_service_execute: int
    wrong_authenticated_access: int
    non_definer: int
    unexpected_names: tuple[str, ...]
    missing_names: tuple[str, ...]
    mentions_aal2_count: int
    admin_alias_references: int
    metadata_only: bool
    function_definitions_exported: bool
    student_data_exported: bool
    production_write_authorized: bool
    function_authorization_verified: bool
    mfa_enforcement_verified: bool
    remote_branch_replay_verified: bool


def _parse_bool(value: str) -> bool:
    if value in ("t", "true"):
        return True
    if value in ("f", "false"):
        return False
    raise ValueError("Unexpected privilege flag; metadata only is accepted.")


def parse_inventory(contents: str) -> dict[str, FunctionPrivilege]:
    """Reject unexpected columns, duplicate signatures and code-like values."""
    functions: dict[str, FunctionPrivilege] = {}
    for line in contents.splitlines():
        if not line:
            continue
        columns = line.split("\t")
        if len(columns) != 8:
            raise ValueError("Sensitive function inventory must have eight columns.")
        signature, *flags = columns
        if len(signature) > 180:
            raise ValueError("Oversized function signature.")
        match = SIGNATURE.fullmatch(signature)
        if match is None:
            raise ValueError("Invalid function signature or raw SQL found.")
        name = match.group(1)
        if name in functions:
            raise ValueError("Duplicate sensitive function name/overload.")
        bools = tuple(_parse_bool(flag) for flag in flags)
        functions[name] = FunctionPrivilege(name, *bools)
        if len(functions) > MAX_ROWS:
            raise ValueError("Sensitive function inventory exceeds limit.")
    if not functions:
        raise ValueError("Sensitive function inventory is empty.")
    return functions


def audit(functions: dict[str, FunctionPrivilege]) -> PrivacyFunctionAssessment:
    """Check privileges, never infer access safety from a name or an alias."""
    names = set(functions)
    violations = (
        names != EXPECTED
        or any(not row.security_definer for row in functions.values())
        or any(row.anon_execute for row in functions.values())
        or any(not row.service_execute for row in functions.values())
        or any(not row.explicit_search_path for row in functions.values())
        or any(
            row.authenticated_execute != (name in AUTHENTICATED_WRAPPERS)
            for name, row in functions.items()
        )
    )
    return PrivacyFunctionAssessment(
        status=(
            "PRIVACY_PRIVILEGE_BOUNDARY_VIOLATION" if violations
            else "PRIVACY_HIGH_PRIVILEGE_REVIEW_REQUIRED"
        ),
        inspected_functions=len(functions),
        authenticated_wrappers=sum(
            row.authenticated_execute for row in functions.values()
        ),
        service_only_functions=sum(
            not row.authenticated_execute for row in functions.values()
        ),
        anon_exposed=sum(row.anon_execute for row in functions.values()),
        missing_search_path=sum(
            not row.explicit_search_path for row in functions.values()
        ),
        missing_service_execute=sum(
            not row.service_execute for row in functions.values()
        ),
        wrong_authenticated_access=sum(
            row.authenticated_execute != (name in AUTHENTICATED_WRAPPERS)
            for name, row in functions.items()
        ),
        non_definer=sum(
            not row.security_definer for row in functions.values()
        ),
        unexpected_names=tuple(sorted(names - EXPECTED)),
        missing_names=tuple(sorted(EXPECTED - names)),
        mentions_aal2_count=sum(row.mentions_aal2 for row in functions.values()),
        admin_alias_references=sum(
            row.references_admin_mfa_alias for row in functions.values()
        ),
        metadata_only=True,
        function_definitions_exported=False,
        student_data_exported=False,
        production_write_authorized=False,
        function_authorization_verified=False,
        mfa_enforcement_verified=False,
        remote_branch_replay_verified=False,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.inventory.resolve() == args.output.resolve():
            raise ValueError("The audit must not overwrite its input.")
        rows = parse_inventory(args.inventory.read_text(encoding="utf-8"))
        result = audit(rows)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(asdict(result), ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, UnicodeError) as error:
        print(f"::error::Privacy function metadata audit failed: {error}", file=sys.stderr)
        return 2
    print(f"Privacy function audit: {result.status}")
    return 1 if result.status == "PRIVACY_PRIVILEGE_BOUNDARY_VIOLATION" else 0


if __name__ == "__main__":
    raise SystemExit(main())
