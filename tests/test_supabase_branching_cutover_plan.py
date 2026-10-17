"""Contracts for fail-closed, read-only Supabase cutover planning."""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

from scripts.analyze_supabase_migration_reconciliation import Migration, reconcile
from scripts.plan_supabase_branching_cutover import assemble_plan, create_plan


def migration(version: str, name: str, sql: str) -> Migration:
    return Migration(version, name, hashlib.sha256(sql.encode("utf-8")).hexdigest())


class CutoverPlanTests(unittest.TestCase):
    def evaluate(
        self,
        production: list[Migration],
        repository: list[Migration],
        *,
        config: bool = True,
        seed: bool = True,
    ):
        return assemble_plan(
            production,
            repository,
            reconcile(production, repository),
            bootstrap_overlays=78,
            bootstrap_sha256="a" * 64,
            config_present=config,
            seed_present=seed,
        )

    def test_perfect_metadata_alignment_never_approves_remote_branching(self) -> None:
        same = migration("20261012000000", "fixture", "select 1;")
        report = self.evaluate([same], [same])
        self.assertEqual(report.status, "BLOCKED_REMOTE_VALIDATION")
        self.assertEqual(report.shared_versions, 1)
        self.assertFalse(report.production_ledger_write_authorized)
        self.assertFalse(report.automatic_branching_authorized)
        self.assertFalse(report.complete_remote_preview_verified)
        self.assertFalse(report.historical_replay_authorized)

    def test_timestamp_alias_does_not_authorize_ledger_repair(self) -> None:
        remote = migration("20261013000000", "fixture", "select 1;")
        local = migration("20261013000001", "fixture", "select 1;")
        report = self.evaluate([remote], [local])
        self.assertEqual(report.proven_timestamp_aliases, 1)
        self.assertEqual(report.status, "BLOCKED_RECONCILIATION")
        self.assertEqual(report.missing_repository_versions, 1)
        self.assertEqual(report.unregistered_repository_versions, 1)

    def test_identical_migration_name_with_different_sql_is_not_accepted(self) -> None:
        remote = migration("20261013000000", "fixture", "select 1;")
        local = migration("20261013000000", "fixture", "select 2;")
        report = self.evaluate([remote], [local])
        self.assertEqual(report.changed_shared_versions, 1)
        self.assertEqual(report.status, "BLOCKED_RECONCILIATION")

    def test_missing_config_and_seed_are_explicit_blockers(self) -> None:
        record = migration("20261013000000", "fixture", "select 1;")
        report = self.evaluate([record], [record], config=False, seed=False)
        self.assertFalse(report.config_committed)
        self.assertFalse(report.synthetic_seed_committed)
        self.assertTrue(any("config and synthetic seed" in x for x in report.blockers))

    def test_report_contains_no_stored_sql_names_or_student_data(self) -> None:
        remote = migration("20261013000000", "historical_private_student_email", "private")
        local = migration("20261013000001", "different", "public")
        report = self.evaluate([remote], [local])
        serialized = json.dumps(asdict(report))
        self.assertNotIn("historical_private_student_email", serialized)
        self.assertNotIn("select ", serialized.lower())
        self.assertNotIn("private", serialized.lower())

    def test_unreviewed_or_missing_bootstrap_is_rejected(self) -> None:
        entry = migration("20261013000000", "fixture", "select 1;")
        with self.assertRaises(ValueError):
            assemble_plan(
                [entry], [entry], reconcile([entry], [entry]),
                bootstrap_overlays=0,
                bootstrap_sha256="",
                config_present=True, seed_present=True,
            )

    def test_repository_plan_is_generated_without_modifying_migrations(self) -> None:
        root = Path(__file__).resolve().parents[1]
        versions = sorted((root / "supabase/migrations").glob("*.sql"))
        self.assertTrue(versions)
        source = versions[-1]
        before = source.read_bytes()
        local_entry = migration(source.name[:14], source.name[15:-4], source.read_text().strip())
        plan = create_plan(root, f"{local_entry.version}\t{local_entry.name}\t{local_entry.checksum}\n")
        self.assertEqual(plan.bootstrap_overlays, 84)
        self.assertEqual(plan.status, "BLOCKED_RECONCILIATION")
        self.assertEqual(before, source.read_bytes())
        self.assertFalse(plan.production_ledger_write_authorized)


if __name__ == "__main__":
    unittest.main()
