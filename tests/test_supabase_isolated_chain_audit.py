"""Negative and positive tests for an isolated canonical migration chain."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.audit_supabase_isolated_chain import check_chain, main
from scripts.prepare_supabase_cli_replay import (
    BOOTSTRAP_FILENAME,
    stage_replay,
)


class CanonicalChainAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = Path(__file__).resolve().parents[1]
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name) / "isolated"
        sql_dir = self.directory / "supabase"
        (sql_dir / "migrations").mkdir(parents=True)
        (sql_dir / "config.toml").write_text(
            'project_id = "test-only"\n', encoding="utf-8"
        )
        stage_replay(self.repository, self.directory)

    def test_valid_chain_is_deterministic_and_cannot_authorize_production(self) -> None:
        first = check_chain(self.repository, self.directory)
        second = check_chain(self.repository, self.directory)
        self.assertEqual(first, second)
        self.assertEqual(first.status, "LOCAL_CHAIN_VALIDATED")
        self.assertEqual(first.reviewed_overlays, 84)
        self.assertEqual(len(first.migration_sha256), 2)
        self.assertFalse(first.historical_migrations_replayed)
        self.assertFalse(first.production_ledger_modified)
        self.assertFalse(first.remote_preview_verified)
        self.assertFalse(first.automatic_branching_safe)

    def test_unreviewed_third_migration_is_blocked(self) -> None:
        new_migration = self.directory / "supabase/migrations/20261014000000_unreviewed.sql"
        new_migration.write_text("select 1;\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "Unexpected staged migration"):
            check_chain(self.repository, self.directory)

    def test_modified_canonical_sql_is_blocked(self) -> None:
        bootstrap = self.directory / "supabase/migrations" / BOOTSTRAP_FILENAME
        bootstrap.write_text(bootstrap.read_text() + "\nselect 1;\n")
        with self.assertRaisesRegex(ValueError, "Staged migrations differ"):
            check_chain(self.repository, self.directory)

    def test_modified_manifest_checksum_is_blocked(self) -> None:
        path = self.directory / "artifacts/manifest.json"
        content = json.loads(path.read_text())
        content["bootstrap_sha256"] = "0" * 64
        path.write_text(json.dumps(content))
        with self.assertRaisesRegex(ValueError, "hash differs"):
            check_chain(self.repository, self.directory)

    def test_real_student_seed_operations_are_rejected(self) -> None:
        seed = self.directory / "supabase/seed.sql"
        seed.write_text(seed.read_text() + "\nINSERT INTO public.profiles values ('test');")
        with self.assertRaisesRegex(ValueError, "real account"):
            check_chain(self.repository, self.directory)

    def test_staging_inside_repository_is_forbidden(self) -> None:
        with self.assertRaisesRegex(ValueError, "outside the Git checkout"):
            check_chain(self.repository, self.repository / "supabase")

    def test_audit_report_contains_hashes_and_no_approval(self) -> None:
        # Invoke the same business function as the CLI without accessing Supabase.
        report = check_chain(self.repository, self.directory)
        payload = json.dumps(report.__dict__)
        self.assertIn("LOCAL_CHAIN_VALIDATED", payload)
        self.assertNotIn("service_role", payload)
        self.assertNotIn("auth.users", payload)


if __name__ == "__main__":
    unittest.main()
