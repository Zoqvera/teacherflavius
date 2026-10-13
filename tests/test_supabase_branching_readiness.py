"""Unit tests for the non-mutating Supabase branching preflight."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.check_supabase_branching_readiness import (
    evaluate_readiness,
    parse_local_versions,
    parse_production_versions,
)


class BranchingReadinessTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.migrations = self.root / "supabase" / "migrations"
        self.migrations.mkdir(parents=True)

    def add_migration(self, version: str, name: str = "example") -> None:
        (self.migrations / f"{version}_{name}.sql").write_text(
            "-- Synthetic schema fixture only.\n", encoding="utf-8"
        )

    def finish_bootstrap(self) -> None:
        (self.root / "supabase" / "config.toml").write_text(
            'project_id = "teacherflavius-tests"\n', encoding="utf-8"
        )
        (self.root / "supabase" / "seed.sql").write_text(
            "-- Placeholder for synthetic data.\n", encoding="utf-8"
        )

    def test_detects_missing_and_unregistered_versions(self) -> None:
        self.add_migration("20261013000001")
        self.add_migration("20261013000002")
        report = evaluate_readiness(
            self.root, {"20261013000001", "20261013000003"}
        )
        self.assertEqual(report.status, "BLOCKED")
        self.assertEqual(report.shared_versions, 1)
        self.assertEqual(report.missing_from_repository, 1)
        self.assertEqual(report.unregistered_in_production, 1)
        self.assertEqual(report.missing_from_repository_sample, ("20261013000003",))
        self.assertEqual(report.unregistered_in_production_sample, ("20261013000002",))

    def test_duplicate_versions_block_branching(self) -> None:
        self.add_migration("20261013000001", "first")
        self.add_migration("20261013000001", "second")
        local, duplicate, invalid = parse_local_versions(self.migrations)
        self.assertEqual(local, {"20261013000001"})
        self.assertEqual(duplicate, ("20261013000001",))
        self.assertFalse(invalid)

    def test_invalid_filenames_block_branching(self) -> None:
        (self.migrations / "invalid_migration.sql").touch()
        local, duplicate, invalid = parse_local_versions(self.migrations)
        self.assertFalse(local)
        self.assertFalse(duplicate)
        self.assertEqual(invalid, ("invalid_migration.sql",))

    def test_valid_ledger_without_safe_bootstrap_still_blocks(self) -> None:
        self.add_migration("20261013000001")
        report = evaluate_readiness(self.root, {"20261013000001"})
        self.assertEqual(report.status, "BLOCKED")
        self.assertTrue(report.missing_branching_config)
        self.assertTrue(report.missing_synthetic_seed)

    def test_alignment_is_not_misreported_as_complete_validation(self) -> None:
        self.add_migration("20261013000001")
        self.finish_bootstrap()
        report = evaluate_readiness(self.root, {"20261013000001"})
        self.assertEqual(report.status, "METADATA_ALIGNED")
        self.assertIn("clean database migration replay", report.reason)

    def test_production_ledger_rejects_sql_statements_or_student_data(self) -> None:
        for content in ("20261013000001\nDROP TABLE profiles", "email@example.com"):
            with self.subTest(content=content):
                with self.assertRaises(ValueError):
                    parse_production_versions(content)

    def test_blank_remote_snapshot_cannot_pass(self) -> None:
        with self.assertRaises(ValueError):
            parse_production_versions("   \n")

    def test_script_json_report_has_no_database_sql(self) -> None:
        self.add_migration("20261013000001")
        source = self.root / "versions.txt"
        source.write_text("20261013000001\n20261013000002\n", encoding="utf-8")
        output = self.root / "report.json"
        script = Path(__file__).resolve().parents[1] / "scripts" / "check_supabase_branching_readiness.py"
        run = subprocess.run(
            [sys.executable, str(script), "--repository-root", str(self.root),
             "--production-versions-file", str(source), "--report-json", str(output)],
            check=False, text=True, capture_output=True,
        )
        self.assertEqual(run.returncode, 1)
        self.assertEqual(json.loads(output.read_text())["status"], "BLOCKED")
        self.assertNotIn("DROP TABLE", run.stdout)


if __name__ == "__main__":
    unittest.main()
