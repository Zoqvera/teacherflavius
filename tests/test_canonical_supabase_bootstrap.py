"""Contract tests for the disposable-only consolidated Supabase bootstrap."""
from __future__ import annotations

import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.compile_canonical_supabase_bootstrap import (
    FRESH_DATABASE_GUARD,
    compile_bootstrap,
    extract_fingerprint_query,
    parse_baseline_order,
    write_outputs,
)


class CanonicalBootstrapTests(unittest.TestCase):
    def test_exact_order_is_taken_from_reviewed_restore_workflow(self) -> None:
        workflow = (
            "      for file in \\\n"
            "        supabase/baseline/10_public_schema.sql \\\n"
            "        supabase/baseline/20_default_privileges.sql \\\n"
            "        supabase/baseline/375_preserve_historical_credits_and_profile_integrity.sql\n"
            "      do\n"
        )
        with self.assertRaisesRegex(ValueError, "unexpectedly changed"):
            parse_baseline_order(workflow)

    def test_committed_restore_has_expected_first_last_and_unique_order(self) -> None:
        root = Path(__file__).resolve().parents[1]
        workflow = (root / ".github/workflows/validate-supabase-baseline.yml").read_text()
        paths = parse_baseline_order(workflow)
        self.assertGreaterEqual(len(paths), 60)
        self.assertEqual(paths[0], "supabase/baseline/10_public_schema.sql")
        self.assertEqual(
            paths[-1], "supabase/baseline/390_expose_study_button_marker.sql"
        )
        self.assertEqual(len(paths), len(set(paths)))

    def test_bootstrap_contains_exactly_the_existing_reviewed_overlays(self) -> None:
        root = Path(__file__).resolve().parents[1]
        compiled, manifest = compile_bootstrap(root)
        self.assertEqual(compiled.count("-- BEGIN REVIEWED OVERLAY: "), 79)
        self.assertEqual(manifest["overlay_count"], 79)
        self.assertEqual(manifest["mode"], "disposable-only")
        self.assertEqual(
            manifest["bootstrap_sha256"],
            hashlib.sha256(compiled.encode("utf-8")).hexdigest(),
        )
        self.assertTrue(compiled.startswith("-- DISPOSABLE DATABASE ONLY."))
        self.assertIn("create table public.profiles", compiled)
        self.assertIn("private.lesson_credit_plan_exceptions", compiled)
        self.assertEqual(compiled.count(FRESH_DATABASE_GUARD.strip()), 1)
        self.assertLess(
            compiled.index(FRESH_DATABASE_GUARD.strip()),
            compiled.index("create table public.profiles"),
        )
        self.assertLess(
            compiled.index(FRESH_DATABASE_GUARD.strip()),
            compiled.index("set check_function_bodies"),
        )

    def test_never_write_to_live_migrations_folder(self) -> None:
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            with self.assertRaisesRegex(ValueError, "production migrations"):
                write_outputs(
                    root,
                    root / "supabase/migrations/20261013010000_unsafe.sql",
                    temporary / "manifest.json",
                    temporary / "fingerprint.sql",
                )

    def test_writes_sql_manifest_and_fingerprint_query_to_temp_location(self) -> None:
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            temporary = Path(directory)
            sql = temporary / "bootstrap.sql"
            manifest = temporary / "manifest.json"
            fingerprint = temporary / "fingerprint.sql"
            write_outputs(root, sql, manifest, fingerprint)
            report = json.loads(manifest.read_text())
            self.assertEqual(report["overlay_count"], 79)
            self.assertIn("public_functions", fingerprint.read_text())
            self.assertIn("select json_build_object(", fingerprint.read_text())
            self.assertIn("create table public.profiles", sql.read_text())

    def test_rejects_workflow_without_fingerprint(self) -> None:
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            extract_fingerprint_query("name: ordinary workflow")


if __name__ == "__main__":
    unittest.main()
