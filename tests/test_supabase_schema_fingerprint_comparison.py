"""Regression tests for production-versus-reconstruction catalog diagnostics."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.compare_supabase_schema_fingerprint import METRICS, compare, validated_counts

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "scripts/sql/supabase_catalog_fingerprint_readonly.sql"
SCRIPT = ROOT / "scripts/compare_supabase_schema_fingerprint.py"


def counts(value: int = 1) -> dict:
    result = {metric: value for metric in METRICS}
    result["captured_from_migration_version"] = "20261013143000"
    return result


class FingerprintComparisonTests(unittest.TestCase):
    def test_detects_production_differences_without_approving_a_cutover(self) -> None:
        baseline = counts()
        production = {metric: baseline[metric] for metric in METRICS}
        production["tables"] += 29
        production["public_functions"] += 154
        result = compare(baseline, production)

        self.assertEqual(result.status, "SCHEMA_DRIFT_DETECTED")
        self.assertEqual(result.changed_metric_count, 2)
        self.assertEqual(result.differences["tables"].delta, 29)
        self.assertEqual(result.differences["public_functions"].delta, 154)
        self.assertFalse(result.verifies_full_schema_equivalence)
        self.assertFalse(result.verifies_backup_recoverability)
        self.assertFalse(result.production_write_authorized)

    def test_equal_counts_are_not_full_schema_equivalence(self) -> None:
        baseline = counts()
        production = {metric: baseline[metric] for metric in METRICS}
        result = compare(baseline, production)

        self.assertEqual(result.status, "SCHEMA_COUNTS_ALIGNED")
        self.assertEqual(result.changed_metric_count, 0)
        self.assertFalse(result.verifies_full_schema_equivalence)

    def test_invalid_or_excess_fields_are_rejected(self) -> None:
        for payload in (
            {"tables": 1},
            {**counts(), "tables": True},
            {**counts(), "tables": -1},
            {**counts(), "name": "student@example.org"},
            {**counts(), "captured_from_migration_version": "wrong"},
        ):
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    validated_counts(payload, baseline=True)

    def test_production_payload_rejects_unexpected_version_or_data(self) -> None:
        for payload in (
            {**counts()},
            {**{metric: 1 for metric in METRICS}, "student_id": "synthetic"},
        ):
            with self.assertRaises(ValueError):
                validated_counts(payload, baseline=False)

    def test_command_outputs_only_non_sensitive_metric_differences(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            baseline = counts()
            production = {metric: baseline[metric] for metric in METRICS}
            production["tables"] = 81
            (folder / "baseline.json").write_text(json.dumps(baseline))
            (folder / "production.json").write_text(json.dumps(production))
            result = subprocess.run(
                [
                    sys.executable, str(SCRIPT),
                    "--baseline-json", str(folder / "baseline.json"),
                    "--production-json", str(folder / "production.json"),
                    "--report-json", str(folder / "report.json"),
                ],
                capture_output=True, text=True, check=False,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads((folder / "report.json").read_text())
            self.assertEqual(report["status"], "SCHEMA_DRIFT_DETECTED")
            self.assertEqual(report["differences"]["tables"]["production"], 81)
            self.assertNotIn("student_id", json.dumps(report))

    def test_metadata_sql_is_read_only_and_avoids_private_records(self) -> None:
        sql = SQL.read_text(encoding="utf-8").lower()
        self.assertEqual(sql.count("select json_build_object("), 1)
        self.assertEqual(sql.count(";"), 1)
        for metric in METRICS:
            self.assertIn(f"'{metric}'", sql)
        for unsafe in ("insert into", "update public.", "delete from", "drop table",
                       "auth.users", "supabase_migrations.schema_migrations",
                       "from public.profiles", "from public.monthly_tuition"):
            self.assertNotIn(unsafe, sql)


if __name__ == "__main__":
    unittest.main()
