"""RLS policy posture comparison contracts."""
from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

from scripts.compare_supabase_rls_posture import compare_policies, parse_inventory

ROOT = Path(__file__).resolve().parents[1]


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def row(name: str, command: str, roles: str, predicate: str = "owner", mode: str = "PERMISSIVE") -> str:
    return "\t".join((name, command, mode, roles, digest(predicate), digest("check")))


class RlsPostureTests(unittest.TestCase):
    def test_separates_permissions_and_predicate_differences(self) -> None:
        baseline = parse_inventory("\n".join((
            row("public.profiles.view", "ALL", "anon,authenticated"),
            row("public.payments.view", "SELECT", "authenticated", "unsafe"),
            row("public.legacy.view", "SELECT", "authenticated"),
        )))
        production = parse_inventory("\n".join((
            row("public.profiles.view", "SELECT", "authenticated"),
            row("public.payments.view", "SELECT", "authenticated", "safe"),
            row("public.new.view", "SELECT", "authenticated"),
        )))
        report = compare_policies(baseline, production)
        self.assertEqual(report.status, "POLICY_POSTURE_DIFFERENCES")
        self.assertEqual(report.absent_in_baseline, 1)
        self.assertEqual(report.extra_in_baseline, 1)
        self.assertEqual(report.changed_role_or_command, 1)
        self.assertEqual(report.changed_predicates_only, 1)
        self.assertEqual(report.potential_baseline_role_broadening, 1)
        self.assertFalse(report.expressions_exported)
        self.assertFalse(report.security_equivalence_verified)
        self.assertFalse(report.production_write_authorized)
        self.assertEqual(report.privilege_difference_examples, ("public.profiles.view",))

    def test_matching_metadata_is_not_authorization_approval(self) -> None:
        rows = parse_inventory(row("public.profiles.owner", "SELECT", "authenticated"))
        report = compare_policies(rows, rows)
        self.assertEqual(report.status, "POLICY_POSTURE_METADATA_MATCH")
        self.assertFalse(report.security_equivalence_verified)
        self.assertFalse(report.remote_branch_replay_verified)

    def test_rejects_raw_policy_expressions_and_duplicate_names(self) -> None:
        cases = [
            "public.profiles.owner\tSELECT\tPERMISSIVE\tauthenticated\tauth.uid()\t" + digest("x"),
            row("public.profiles.owner", "SELECT", "authenticated") + "\n" +
            row("public.profiles.owner", "SELECT", "authenticated"),
            row("public.profiles.owner", "SELECT", "authenticated,authenticated"),
            row("public.profiles.owner", "TRUNCATE", "authenticated"),
            row("public.profiles.owner", "SELECT", "authenticated").replace("PERMISSIVE", "UNKNOWN"),
            "",
        ]
        for example in cases:
            with self.subTest(example=example[:40]):
                with self.assertRaises(ValueError):
                    parse_inventory(example)

    def test_production_query_hashes_expressions_before_export(self) -> None:
        sql = (ROOT / "scripts/sql/supabase_rls_policy_posture_readonly.sql").read_text(encoding="utf-8").lower()
        self.assertIn("pg_catalog.pg_policies", sql)
        self.assertIn("sha256(", sql)
        self.assertIn("coalesce(qual, '')", sql)
        self.assertIn("coalesce(with_check, '')", sql)
        self.assertNotIn("select *", sql)
        self.assertNotIn("supabase_migrations.schema_migrations", sql)
        self.assertNotIn("delete from", sql)
        self.assertNotIn("update public.", sql)


if __name__ == "__main__":
    unittest.main()
