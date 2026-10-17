"""Contract tests for object-level reconstruction diagnostics."""
from __future__ import annotations

import hashlib
import unittest
from pathlib import Path

from scripts.compare_supabase_object_inventories import compare, parse_inventory


ROOT = Path(__file__).resolve().parents[1]
QUERY = ROOT / "scripts/sql/supabase_schema_object_inventory_readonly.sql"


def fingerprint(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def row(kind: str, identifier: str, definition: str) -> str:
    return f"{kind}\t{identifier}\t{fingerprint(definition)}"


class SchemaObjectInventoryTests(unittest.TestCase):
    def test_detects_missing_changed_and_extra_objects(self) -> None:
        baseline = parse_inventory("\n".join((
            row("relation", "public.profiles", "old"),
            row("routine", "public.is_teacher_admin()", "old"),
            row("column", "public.profiles.id", "same"),
        )))
        production = parse_inventory("\n".join((
            row("relation", "public.profiles", "new"),
            row("column", "public.profiles.id", "same"),
            row("relation", "public.teacher_admins", "new"),
        )))
        result = compare(baseline, production)
        self.assertEqual(result.status, "RECONSTRUCTION_GAPS_DETECTED")
        self.assertEqual(result.shared_identifiers, 2)
        self.assertEqual(result.identical_definitions, 1)
        self.assertEqual(result.different_definitions, 1)
        self.assertEqual(result.missing_in_baseline, 1)
        self.assertEqual(result.extra_in_baseline, 1)
        self.assertEqual(result.by_kind["relation"]["missing_in_baseline"], 1)
        self.assertIn(
            "relation:public.teacher_admins",
            result.missing_in_baseline_examples,
        )

    def test_perfect_alignment_does_not_authorize_deployment(self) -> None:
        data = parse_inventory(row("policy", "public.profiles.owner", "valid"))
        result = compare(data, data)
        self.assertEqual(result.status, "SCHEMA_OBJECTS_ALIGNED")
        self.assertFalse(result.production_write_authorized)
        self.assertFalse(result.remote_branch_replay_verified)
        self.assertFalse(result.complete_schema_equivalence_verified)
        self.assertFalse(result.migration_ledger_modified)

    def test_rejects_sql_source_instead_of_digests(self) -> None:
        invalid = (
            "routine\tpublic.test()\tCREATE FUNCTION public.test()...",
            "table\tpublic.x\t" + fingerprint("x"),
            row("relation", "public.x", "ok") + "\n" + row("relation", "public.x", "ok"),
            "",
            row("relation", "public.x\nmalicious", "ok"),
            "relation\t\t" + fingerprint("ok"),
        )
        for value in invalid:
            with self.subTest(value=value[:60]):
                with self.assertRaises(ValueError):
                    parse_inventory(value)

    def test_report_only_carries_identifiers_and_aggregate_counts(self) -> None:
        actual = compare(
            parse_inventory(row("routine", "private.audit()", "irrelevant def")),
            parse_inventory(row("routine", "private.audit()", "new def")),
        )
        self.assertEqual(actual.different_definitions, 1)
        self.assertFalse(actual.raw_definitions_exported)
        self.assertFalse(actual.student_data_exported)
        self.assertTrue(actual.metadata_only)
        self.assertNotIn("new def", str(actual))

    def test_readonly_inventory_query_uses_server_side_hashing(self) -> None:
        sql = QUERY.read_text(encoding="utf-8").lower()
        self.assertIn("pg_catalog.sha256", sql)
        self.assertIn("pg_catalog.pg_get_functiondef", sql)
        self.assertIn("pg_catalog.pg_policies", sql)
        self.assertIn("from inventory", sql)
        self.assertNotIn("supabase_migrations.schema_migrations", sql)
        self.assertNotIn("select *", sql)
        self.assertNotIn("copy ", sql)
        self.assertNotIn("insert into ", sql)
        self.assertNotIn("update public.", sql)
        self.assertNotIn("delete from ", sql)


if __name__ == "__main__":
    unittest.main()
