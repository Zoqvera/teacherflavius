#!/usr/bin/env python3
"""Classify sensitive changes and report isolated-preview evidence.

The GitHub workflow uses advisory mode to avoid blocking pull requests.
Strict mode remains available for manual verification. Neither mode proves
that a remote Supabase branch passed; live results must be checked separately.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

PRODUCTION_PROJECT_REF = "wnigzpvgsbpjdxvjzugt"

CRITICAL_PREFIXES = (
    "supabase/migrations/",
    "supabase/baseline/",
    "supabase/functions/",
    "supabase/recovery/",
    "supabase/schemas/",
)
CRITICAL_EXACT_FILES = {
    "supabase/config.toml",
    "supabase/seed.sql",
    "supabase_config.js",
    "site_runtime_config.js",
    "student_data_utils.js",
    "supabase_client_service.js",
    "auth.js",
    "auth_session_service.js",
    "auth_navigation_service.js",
    "password_recovery_login.js",
    "login.html",
    "mensalidades.js",
    "mensalidades.html",
    "payment.js",
}
CRITICAL_CODE_PREFIXES = (
    "auth_", "payment_", "tuition_", "monthly_tuition_", "mercado_pago_",
    "student_billing_", "student_enrollment_", "lesson_credit_",
    "reposicoes_", "matricula_", "mensalidades", "class_students_",
    "makeup_", "student_course_", "teacher_classes_", "class_students_",
    "student_access_", "login_",
)
CRITICAL_SITE_ROUTES = (
    "login/", "recuperar-senha/", "mensalidades/", "matricula/",
    "reposicoes-admin/", "acesso-aluno/", "area-do-estudante/",
    "perfil/", "cadastro/",
)
SUPPORTED_CODE_SUFFIXES = {".js", ".ts", ".tsx", ".jsx", ".sql", ".html"}


def requires_remote_preview(file_path: str) -> bool:
    """Flag database, authentication and financially sensitive application code."""
    normalized = file_path.strip().replace("\\", "/").lstrip("./")
    if not normalized:
        return False
    if normalized.startswith(("docs/", "tests/", ".github/", "scripts/")):
        return False
    if normalized.startswith(CRITICAL_PREFIXES):
        return True
    if normalized in CRITICAL_EXACT_FILES:
        return True
    if normalized.startswith("supabase_") and normalized.endswith(".sql"):
        return True
    if normalized.startswith(CRITICAL_SITE_ROUTES):
        return Path(normalized).suffix in SUPPORTED_CODE_SUFFIXES
    name = normalized.rsplit("/", 1)[-1]
    return (
        Path(name).suffix in SUPPORTED_CODE_SUFFIXES
        and name.startswith(CRITICAL_CODE_PREFIXES)
    )


def get_field(body: str, label: str) -> str:
    """Read one unambiguous named field in the pull request's test record."""
    pattern = re.compile(r"^\s*" + re.escape(label) + r"\s*:\s*(.+?)\s*$", re.I | re.M)
    matches = pattern.findall(body)
    return matches[0].strip().strip("`") if len(matches) == 1 else ""


def validate_evidence(body: str) -> list[str]:
    """Require an attributable preview ref and reproducible test evidence."""
    problems: list[str] = []
    ref = get_field(body, "Preview project ref")
    if not re.fullmatch(r"[a-z0-9]{20}", ref) or ref == PRODUCTION_PROJECT_REF:
        problems.append("Provide a 20-character Supabase preview project ref different from production.")

    preview_url = get_field(body, "Preview dashboard")
    url = urlparse(preview_url)
    if (
        url.scheme != "https"
        or url.netloc != "supabase.com"
        or url.path.rstrip("/") != f"/dashboard/project/{ref}"
    ):
        problems.append("Provide the Supabase dashboard URL matching that preview project ref.")

    evidence_url = get_field(body, "Test evidence")
    evidence = urlparse(evidence_url)
    if (
        evidence.scheme != "https"
        or evidence.netloc != "github.com"
        or not re.fullmatch(r"/Zoqvera/teacherflavius/actions/runs/[0-9]+/?", evidence.path)
    ):
        problems.append("Link a GitHub Actions test run for the isolated scenario.")

    if get_field(body, "Preview result").upper() != "PASS":
        problems.append("Set 'Preview result: PASS' only after verifying the actual branch.")
    if get_field(body, "Test data").upper() != "SYNTHETIC":
        problems.append("State 'Test data: SYNTHETIC'; never copy student data to previews.")
    if get_field(body, "External integrations").upper() != "MOCKED":
        problems.append("State 'External integrations: MOCKED' after sandboxing outbound effects.")
    return problems


def assess(paths: list[str], body: str) -> tuple[list[str], list[str]]:
    critical = sorted(set(path for path in paths if requires_remote_preview(path)))
    return critical, validate_evidence(body) if critical else []


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--changed-files", type=Path, required=True)
    parser.add_argument("--pr-body", type=Path, required=True)
    parser.add_argument(
        "--advisory",
        action="store_true",
        help="Report missing preview evidence without blocking the pull request.",
    )
    args = parser.parse_args()
    paths = args.changed_files.read_text(encoding="utf-8").splitlines()
    body = args.pr_body.read_text(encoding="utf-8")
    critical, problems = assess(paths, body)

    if not critical:
        print("Isolated Supabase preview not required by this policy; normal CI applies.")
        return 0

    print(f"Supabase temporary branch required for {len(critical)} critical file(s):")
    for file_path in critical:
        print(f"  - {file_path}")
    if problems:
        severity = "warning" if args.advisory else "error"
        for problem in problems:
            print(f"::{severity}::{problem}")
        if args.advisory:
            print(
                "::notice::Remote preview evidence is missing. "
                "This check is advisory only; remote safety has NOT been verified."
            )
            return 0
        print("See docs/estrategia-testes-isolados.md for the evidence template.")
        return 1
    print("Preview evidence declared; verify the live branch and test log before merging.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
