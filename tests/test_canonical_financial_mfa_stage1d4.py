"""Contracts for financial MFA alignment in the disposable schema only."""
from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MFA = ROOT / "supabase/baseline/420_reconcile_financial_mfa_policies.sql"
TEST = ROOT / "tests/sql/canonical_financial_mfa_stage1d4.sql"
WORKFLOW = ROOT / ".github/workflows/validate-supabase-baseline.yml"
BASE = ROOT / "supabase/baseline/10_public_schema.sql"


class FinancialMfaBaselineTests(unittest.TestCase):
    def test_existing_baseline_needs_financial_mfa_update(self) -> None:
        baseline = BASE.read_text(encoding="utf-8")
        for name in (
            "Administradores gerenciam mensalidades",
            "Administradores visualizam eventos financeiros",
            "Administradores gerenciam configurações financeiras",
        ):
            position = baseline.index(f'create policy "{name}"')
            self.assertIn("is_teacher_admin()", baseline[position:position + 330])

    def test_overlay_only_changes_three_financial_policy_predicates(self) -> None:
        sql = MFA.read_text(encoding="utf-8")
        self.assertEqual(sql.lower().count("  alter policy "), 3)
        self.assertIn("baseline_signature is distinct from updated_signature", sql)
        self.assertIn("Financial RLS baseline does not match reviewed preconditions", sql)
        self.assertIn("Unexpected extra financial policies", sql)
        self.assertIn("to_regprocedure('public.is_teacher_admin_mfa()')", sql)
        for name in (
            "Administradores gerenciam mensalidades",
            "Administradores visualizam eventos financeiros",
            "Administradores gerenciam configurações financeiras",
        ):
            self.assertIn(f'alter policy "{name}"', sql)
        self.assertNotIn("create table ", sql.lower())
        self.assertNotIn("supabase_migrations", sql.lower())
        self.assertNotIn("cron.schedule", sql.lower())

    def test_restoration_requires_mfa_and_preserves_lessons(self) -> None:
        sql = TEST.read_text(encoding="utf-8")
        self.assertIn("validated <> 3", sql)
        self.assertIn("qual <> 'is_teacher_admin_mfa()'", sql)
        self.assertIn("Lesson page MFA predicates were unintentionally modified", sql)
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("420_reconcile_financial_mfa_policies.sql", workflow)
        self.assertIn("tests/sql/canonical_financial_mfa_stage1d4.sql", workflow)


if __name__ == "__main__":
    unittest.main()
