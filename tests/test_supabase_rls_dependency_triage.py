"""Fail-closed policy dependency triage tests (no real student data)."""
from __future__ import annotations

import hashlib
import unittest

from scripts.compare_supabase_object_inventories import parse_inventory as parse_objects
from scripts.compare_supabase_rls_posture import parse_inventory as parse_policies
from scripts.triage_missing_supabase_rls_policies import group_missing_policies


def sha(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def policy(name: str) -> str:
    return "\t".join((name, "SELECT", "PERMISSIVE", "authenticated", sha("owner"), sha("check")))


class MissingPolicyDependencyTests(unittest.TestCase):
    def test_groups_by_present_and_absent_relations(self) -> None:
        baseline = parse_policies(policy("public.lessons.owner"))
        production = parse_policies("\n".join((
            policy("public.lessons.owner"),
            policy("public.lessons.teacher"),
            policy("public.exercise_attempts.student"),
            policy("public.exercise_attempts.teacher"),
        )))
        inventory = parse_objects("\n".join((
            f"relation\tpublic.lessons\t{sha('table')}",
            f"column\tpublic.lessons.id\t{sha('column')}",
        )))
        report = group_missing_policies(baseline, production, inventory)
        self.assertEqual(report.missing_policies, 3)
        self.assertEqual(report.missing_on_restored_relations, 1)
        self.assertEqual(report.missing_on_absent_relations, 2)
        self.assertTrue(report.table_dependencies["public.lessons"]["relation_restored"])
        self.assertFalse(report.table_dependencies["public.exercise_attempts"]["relation_restored"])
        self.assertEqual(report.table_dependencies["public.exercise_attempts"]["absent_policies"], 2)
        self.assertFalse(report.contains_predicates)
        self.assertFalse(report.contains_student_records)
        self.assertFalse(report.production_write_authorized)

    def test_empty_gap_does_not_approve_security(self) -> None:
        policies = parse_policies(policy("public.lessons.owner"))
        objects = parse_objects(f"relation\tpublic.lessons\t{sha('table')}")
        result = group_missing_policies(policies, policies, objects)
        self.assertEqual(result.status, "POLICY_IDENTITIES_COMPLETE")
        self.assertFalse(result.security_equivalence_verified)

    def test_rejects_malformed_names(self) -> None:
        baseline = parse_policies(policy("public.lessons.owner"))
        production = parse_policies(
            policy("public.lessons.owner") + "\n" + policy("table_without_schema")
        )
        objects = parse_objects(f"relation\tpublic.lessons\t{sha('x')}")
        with self.assertRaises(ValueError):
            group_missing_policies(baseline, production, objects)


if __name__ == "__main__":
    unittest.main()
