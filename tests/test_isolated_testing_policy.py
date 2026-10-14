"""Regression checks for the branch-gated sensitive-change policy."""
from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.check_isolated_testing_policy import (
    PRODUCTION_PROJECT_REF,
    assess,
    requires_remote_preview,
    validate_evidence,
)

PREVIEW_REF = "abcdefghijklmnopqrst"
EVIDENCE = f"""### Testes isolados
Preview project ref: {PREVIEW_REF}
Preview dashboard: https://supabase.com/dashboard/project/{PREVIEW_REF}
Test evidence: https://github.com/Zoqvera/teacherflavius/actions/runs/123456789
Preview result: PASS
Test data: SYNTHETIC
External integrations: MOCKED
"""


class ClassificationTests(unittest.TestCase):
    def test_critical_business_changes_require_real_preview(self) -> None:
        for filename in (
            "supabase/migrations/20261013120000_fix_payment.sql",
            "supabase/functions/process-payment/index.ts",
            "supabase/baseline/400_protect_payments.sql",
            "supabase/recovery/recovery_manifest.sql",
            "auth.js",
            "mensalidades.js",
            "payment_reconciliation.js",
            "lesson_credit_admin.js",
            "login/index.html",
            "matricula/index.html",
            "recuperar-senha/index.html",
        ):
            with self.subTest(filename=filename):
                self.assertTrue(requires_remote_preview(filename))

    def test_cosmetic_docs_tests_and_workflow_are_standard_ci_only(self) -> None:
        for filename in (
            "docs/estrategia-testes-isolados.md",
            "README.md",
            "responsive_compat.css",
            "tests/test_billing_contract.py",
            ".github/workflows/isolated-testing-policy.yml",
            "scripts/check_isolated_testing_policy.py",
            "index.html",
            "package.json",
        ):
            with self.subTest(filename=filename):
                self.assertFalse(requires_remote_preview(filename))

    def test_critical_pr_with_complete_evidence_passes(self) -> None:
        critical, errors = assess(["auth.js", "mensalidades.js"], EVIDENCE)
        self.assertEqual(critical, ["auth.js", "mensalidades.js"])
        self.assertEqual(errors, [])

    def test_cosmetic_changes_need_no_branch_reference(self) -> None:
        critical, errors = assess(["README.md", "responsive_compat.css"], "")
        self.assertEqual(critical, [])
        self.assertEqual(errors, [])


class EvidenceTests(unittest.TestCase):
    def test_missing_evidence_is_rejected(self) -> None:
        self.assertGreaterEqual(len(validate_evidence("")), 4)

    def test_production_reference_is_never_accepted(self) -> None:
        manipulated = EVIDENCE.replace(PREVIEW_REF, PRODUCTION_PROJECT_REF)
        self.assertTrue(validate_evidence(manipulated))

    def test_link_to_wrong_branch_is_rejected(self) -> None:
        modified = EVIDENCE.replace(
            f"dashboard/project/{PREVIEW_REF}",
            "dashboard/project/zzzzzzzzzzzzzzzzzzzz",
        )
        self.assertTrue(validate_evidence(modified))

    def test_test_evidence_must_be_real_repo_run_url_shape(self) -> None:
        manipulated = EVIDENCE.replace(
            "https://github.com/Zoqvera/teacherflavius/actions/runs/123456789",
            "https://malicious.example/actions/runs/123456789",
        )
        self.assertTrue(validate_evidence(manipulated))

    def test_no_real_integrations_or_production_data(self) -> None:
        self.assertTrue(validate_evidence(EVIDENCE.replace("MOCKED", "LIVE")))
        self.assertTrue(validate_evidence(EVIDENCE.replace("SYNTHETIC", "PRODUCTION")))

    def test_duplicate_fields_are_rejected(self) -> None:
        self.assertTrue(validate_evidence(EVIDENCE + f"Preview project ref: {PREVIEW_REF}\n"))


class AdvisoryModeTests(unittest.TestCase):
    def run_policy(self, advisory: bool) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths_file = root / "changed-files.txt"
            body_file = root / "body.md"
            paths_file.write_text("supabase/migrations/20261014162600_review.sql\\n", encoding="utf-8")
            body_file.write_text("Preview result: PENDING\\n", encoding="utf-8")
            command = [
                sys.executable,
                str(Path(__file__).resolve().parents[1] /
                    "scripts/check_isolated_testing_policy.py"),
                "--changed-files", str(paths_file),
                "--pr-body", str(body_file),
            ]
            if advisory:
                command.append("--advisory")
            return subprocess.run(command, capture_output=True, text=True, check=False)

    def test_advisory_mode_reports_missing_preview_without_blocking(self) -> None:
        result = self.run_policy(advisory=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("::warning::", result.stdout)
        self.assertIn("remote safety has NOT been verified", result.stdout)
        self.assertNotIn("::error::", result.stdout)

    def test_strict_mode_still_reports_missing_preview_as_failure(self) -> None:
        result = self.run_policy(advisory=False)
        self.assertEqual(result.returncode, 1)
        self.assertIn("::error::", result.stdout)


if __name__ == "__main__":
    unittest.main()
