"""Fail-closed contracts for the always-on, fast critical changes gate."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from scripts.check_fast_critical_changes_gate import (
    classify_changes,
    ensure_historical_migrations_unchanged,
)


class FastGateTests(unittest.TestCase):
    def test_regular_documentation_does_not_trigger_slow_tests(self) -> None:
        self.assertEqual(classify_changes(["docs/readme.md"]), frozenset())

    def test_authentication_changes_trigger_local_contracts(self) -> None:
        self.assertEqual(classify_changes(["auth_guard_service.js"]), {"auth"})
        self.assertEqual(classify_changes(["supabase/functions/auth-hook/index.ts"]), {"auth"})

    def test_payments_trigger_local_contracts(self) -> None:
        self.assertEqual(classify_changes(["supabase/functions/mercado-pago-webhook/index.ts"]), {"payment"})
        self.assertEqual(classify_changes(["pagamento/index.html"]), {"payment"})

    def test_sql_changes_trigger_database_tests(self) -> None:
        self.assertEqual(classify_changes(["supabase/migrations/20261014000100_example.sql"]), {"database"})
        self.assertEqual(classify_changes(["supabase/seed.sql"]), {"database"})

    def test_cross_domain_changes_trigger_all_relevant_contracts(self) -> None:
        result = classify_changes([
            "student_enrollment_service.js",
            "supabase/migrations/20261015000100_payment_invoice.sql",
        ])
        self.assertEqual(result, {"auth", "payment", "database"})

    @patch("scripts.check_fast_critical_changes_gate.git_diff", return_value="A\tsupabase/migrations/new.sql\n")
    def test_new_migration_is_allowed(self, mocked_diff) -> None:
        ensure_historical_migrations_unchanged("base", "head")
        mocked_diff.assert_called_once()

    @patch("scripts.check_fast_critical_changes_gate.git_diff", return_value="M\tsupabase/migrations/old.sql\n")
    def test_modified_migration_is_rejected(self, _mocked_diff) -> None:
        with self.assertRaisesRegex(ValueError, "Historical migrations"):
            ensure_historical_migrations_unchanged("base", "head")

    @patch("scripts.check_fast_critical_changes_gate.git_diff", return_value="R100\tsupabase/migrations/old.sql\tsupabase/migrations/new.sql\n")
    def test_renamed_migration_is_rejected(self, _mocked_diff) -> None:
        with self.assertRaisesRegex(ValueError, "Historical migrations"):
            ensure_historical_migrations_unchanged("base", "head")


if __name__ == "__main__":
    unittest.main()
