#!/usr/bin/env python3
"""Run fast, local regression checks for sensitive pull-request changes.

This gate never connects to production, creates Supabase branches, or calls
external payment providers. Expensive integration workflows remain advisory.
"""
from __future__ import annotations

import argparse
import fnmatch
import subprocess
import sys
from typing import Iterable


AUTH_PATTERNS = (
    "auth*.js", "google_auth_*.js", "professor_mfa_*.js",
    "account_security_ui.js", "password_recovery_login.js", "login.html",
    "student_enrollment_service.js", "student_area_route_guard.js",
    "student_data_utils.js", "perfil/**", "acessos_dos_alunos.*",
    "tests/auth*.test.js", "tests/admin_step_up_security_contract.test.js",
    "tests/student_enrollment_service.test.js",
    "tests/account_deletion_security_contracts.test.js",
    ".github/workflows/authentication-contracts.yml",
)
PAYMENT_TERMS = (
    "payment", "tuition", "chargeback", "subscription", "refund",
    "billing", "mercado_pago", "mercado-pago", "mensalidade",
)
DATABASE_PATTERNS = (
    "supabase/migrations/**", "supabase/baseline/**",
    "supabase/config.toml", "supabase/seed.sql",
    "scripts/check_supabase_migration_drift.sh",
    "scripts/prepare_supabase_cli_replay.py",
    "scripts/compile_canonical_supabase_bootstrap.py",
    ".github/workflows/supabase-migration-drift.yml",
    ".github/workflows/validate-supabase-baseline.yml",
)
AUTH_TESTS = (
    "tests/auth_session_service.test.js",
    "tests/auth_password_change.test.js",
    "tests/auth_guard_service.test.js",
    "tests/auth_access_contracts.test.js",
    "tests/admin_step_up_security_contract.test.js",
    "tests/student_enrollment_service.test.js",
    "tests/account_deletion_security_contracts.test.js",
)
PAYMENT_TESTS = (
    "tests/payment_idempotency.test.js",
    "tests/payment_gateway_contract.test.js",
    "tests/payment_concurrency_contract.test.js",
    "tests/payment_refund_operations.test.js",
    "tests/payment_chargeback_operations.test.js",
    "tests/payment_access_hardening_contract.test.js",
    "tests/payment_creation_control.test.js",
    "tests/payment_subscription_reconciliation.test.js",
    "tests/payment_webhook_log.test.js",
    "tests/same_day_first_payment_contract.test.js",
)
DATABASE_TESTS = (
    "tests/supabase_migration_drift_contract.test.js",
    "tests/lesson_credits_contract.test.js",
    "tests/tuition_due_day_required_contract.test.js",
    "tests/quintet_capacity_nine_exceptions_contract.test.js",
)


def matches_any(path: str, patterns: Iterable[str]) -> bool:
    """Match repository-root-relative paths and recursive folder patterns."""
    return any(
        path.startswith(pattern[:-3] + "/") if pattern.endswith("/**")
        else fnmatch.fnmatchcase(path, pattern)
        for pattern in patterns
    )


def classify_changes(paths: Iterable[str]) -> frozenset[str]:
    """Determine which local regression suites are needed."""
    result: set[str] = set()
    for path in paths:
        lower = path.lower()
        if matches_any(path, AUTH_PATTERNS) or (
            path.startswith("supabase/functions/") and
            any(term in lower for term in ("auth", "login", "recovery", "enrollment"))
        ):
            result.add("auth")
        if (
            path.startswith("pagamento/") or
            any(term in lower for term in PAYMENT_TERMS)
        ):
            result.add("payment")
        if matches_any(path, DATABASE_PATTERNS):
            result.add("database")
    return frozenset(result)


def git_diff(base: str, head: str, *args: str) -> str:
    """Read only the local checkout; fail closed when diffs are unavailable."""
    if "--" in args:
        separator = args.index("--")
        command = ["git", "diff", *args[:separator], base, head, "--", *args[separator + 1:]]
    else:
        command = ["git", "diff", *args, base, head]
    output = subprocess.run(
        command,
        check=True, capture_output=True, text=True, encoding="utf-8",
    )
    return output.stdout


def ensure_historical_migrations_unchanged(base: str, head: str) -> None:
    """Only additions are allowed in the immutable historical SQL ledger."""
    changed = git_diff(base, head, "--name-status", "--find-renames", "--", "supabase/migrations/")
    violations = [
        row for row in changed.splitlines()
        if row and row.split("\t", 1)[0] != "A"
    ]
    if violations:
        raise ValueError("Historical migrations cannot be edited, removed or renamed: " + "; ".join(violations))


def run_tests(suite: str) -> None:
    """Execute credential-free contracts only; no network or Docker access."""
    commands: dict[str, tuple[tuple[str, ...], ...]] = {
        "auth": (("node", "--test", *AUTH_TESTS),),
        "payment": (("node", "--test", *PAYMENT_TESTS),),
        "database": (
            ("node", "--test", *DATABASE_TESTS),
            ("python3", "-m", "unittest", "discover", "-s", "tests", "-p", "test_supabase_preview_repository_safety.py"),
        ),
    }
    for command in commands[suite]:
        print(f"Running {suite}: {' '.join(command)}", flush=True)
        subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="Merge commit's first parent")
    parser.add_argument("--head", required=True, help="Current pull-request merge commit")
    args = parser.parse_args()
    try:
        files = [path for path in git_diff(args.base, args.head, "--name-only").splitlines() if path]
        if not files:
            raise ValueError("Cannot verify a pull request with no changed files")
        ensure_historical_migrations_unchanged(args.base, args.head)
        suites = classify_changes(files)
        print(f"Changed files: {len(files)}; fast regression suites: {', '.join(sorted(suites)) or 'none'}", flush=True)
        for suite in ("auth", "payment", "database"):
            if suite in suites:
                run_tests(suite)
    except (OSError, subprocess.CalledProcessError, ValueError) as error:
        print(f"::error::Fast critical gate failed: {error}", file=sys.stderr)
        return 1
    print("Fast critical gate: PASS", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
