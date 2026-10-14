"""Contracts for read-only attestation and synthetic rollback rehearsal."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.analyze_supabase_migration_reconciliation import (
    Migration,
    parse_remote_metadata,
)
from scripts.attest_supabase_migration_ledger import attest, metadata_fingerprint


ROOT = Path(__file__).resolve().parents[1]
ROLLBACK_SQL = ROOT / "tests/fixtures/supabase_synthetic_ledger_rollback.sql"


def record(version: str, name: str, sql: str) -> Migration:
    return Migration(version, name, hashlib.sha256(sql.encode("utf-8")).hexdigest())


class SupabaseLedgerRollbackTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original = [
            record("20261013000001", "first", "select 1;"),
            record("20261013000002", "second", "select 2;"),
        ]

    def test_attestation_of_single_snapshot_is_not_a_restore_proof(self) -> None:
        snapshot = attest(self.original, None)
        self.assertEqual(snapshot.status, "UNVERIFIED_REFERENCE")
        self.assertFalse(snapshot.matches_baseline)
        self.assertFalse(snapshot.restores_full_migration_sql)
        self.assertFalse(snapshot.production_write_authorized)

    def test_identical_snapshots_report_unchanged_without_authorizing_writes(self) -> None:
        snapshot = attest(self.original, list(reversed(self.original)))
        self.assertEqual(snapshot.status, "LEDGER_UNCHANGED")
        self.assertTrue(snapshot.matches_baseline)
        self.assertFalse(snapshot.production_write_authorized)

    def test_changed_body_is_detected_even_if_name_and_version_match(self) -> None:
        observed = [self.original[0], record("20261013000002", "second", "select 9;")]
        snapshot = attest(self.original, observed)
        self.assertEqual(snapshot.status, "LEDGER_DRIFT_DETECTED")
        self.assertFalse(snapshot.matches_baseline)

    def test_removed_or_added_migration_is_detected(self) -> None:
        self.assertEqual(attest(self.original, self.original[:1]).status, "LEDGER_DRIFT_DETECTED")
        new = record("20261013000003", "third", "select 3;")
        self.assertEqual(
            attest(self.original, [*self.original, new]).status, "LEDGER_DRIFT_DETECTED"
        )

    def test_snapshot_digest_is_stable_and_contains_no_source_sql(self) -> None:
        self.assertEqual(
            metadata_fingerprint(self.original),
            metadata_fingerprint(list(reversed(self.original))),
        )
        report = json.dumps(attest(self.original, None).__dict__)
        self.assertNotIn("select 1", report)
        self.assertNotIn('"first"', report)

    def test_corrupt_or_duplicated_snapshot_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            parse_remote_metadata("20261013000001\tfoo\tINVALID")
        with self.assertRaises(ValueError):
            parse_remote_metadata(
                "20261013000001\tfoo\t" + "a" * 64 + "\n"
                "20261013000001\tbar\t" + "b" * 64 + "\n"
            )

    def test_cli_detects_metadata_drift_without_exporting_sql(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            baseline = directory_path / "baseline.tsv"
            changed = directory_path / "changed.tsv"
            report = directory_path / "attestation.json"
            baseline.write_text(
                "\n".join(
                    f"{r.version}\t{r.name}\t{r.checksum}" for r in self.original
                ) + "\n"
            )
            changed.write_text(
                f"{self.original[0].version}\t{self.original[0].name}\t{self.original[0].checksum}\n"
            )
            command = [
                sys.executable, "-m", "scripts.attest_supabase_migration_ledger",
                "--baseline-metadata-file", str(baseline),
                "--observed-metadata-file", str(changed),
                "--report-json", str(report),
            ]
            result = subprocess.run(command, cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            output = json.loads(report.read_text())
            self.assertEqual(output["status"], "LEDGER_DRIFT_DETECTED")
            self.assertFalse(output["production_write_authorized"])
            self.assertNotIn("select 1;", report.read_text())

    def test_pg_rehearsal_has_no_production_migration_targets(self) -> None:
        sql = ROLLBACK_SQL.read_text(encoding="utf-8")
        self.assertIn("create temporary table rehearsal_ledger", sql)
        self.assertIn("create temporary table rehearsal_ledger_snapshot", sql)
        self.assertIn("rollback;", sql)
        self.assertIn("except all", sql)
        self.assertIn("SYNTHETIC_LEDGER_ROLLBACK_PASSED", sql)
        self.assertNotIn("supabase_migrations.schema_migrations", sql.lower().replace(
            "-- no access to supabase_migrations.schema_migrations or application tables.",
            "",
        ))
        self.assertNotIn("public.profiles", sql)
        self.assertNotIn("drop table", sql.lower())


if __name__ == "__main__":
    unittest.main()
