"""Tests for production-safe migration-history reconciliation."""
from __future__ import annotations

import hashlib
import tempfile
import unittest
from pathlib import Path

from scripts.analyze_supabase_migration_reconciliation import (
    Migration,
    parse_remote_metadata,
    read_git_migrations,
    reconcile,
)


def item(version: str, name: str, body: str) -> Migration:
    return Migration(version, name, hashlib.sha256(body.strip().encode()).hexdigest())


class ReconciliationTests(unittest.TestCase):
    def test_same_version_and_sql_is_identical(self) -> None:
        entry = item("20261013000000", "foo", "select 1;")
        r = reconcile([entry], [entry])
        self.assertEqual(r.status, "METADATA_AND_SQL_ALIGNED")
        self.assertEqual(r.same_version_and_sql, 1)

    def test_alias_name_with_new_version_is_only_candidate_until_hash_matches(self) -> None:
        remote = item("20261013000001", "credit_sync", "select 1;")
        local = item("20261013000002", "credit_sync", "select 1;")
        r = reconcile([remote], [local])
        self.assertEqual(r.timestamp_shift_candidates, 1)
        self.assertEqual(r.timestamp_shift_same_sql, 1)
        self.assertEqual(
            r.timestamp_aliases_identical_sql,
            (("20261013000002", "20261013000001"),),
        )
        self.assertEqual(r.remaining_remote_only, 0)
        self.assertEqual(r.remaining_git_only, 0)
        self.assertEqual(r.status, "RECONCILIATION_REQUIRED")

    def test_matching_name_but_different_body_never_auto_reconciles(self) -> None:
        remote = item("20261013000001", "credit_sync", "select 1;")
        local = item("20261013000002", "credit_sync", "select 2;")
        r = reconcile([remote], [local])
        self.assertEqual(r.timestamp_shift_candidates, 1)
        self.assertEqual(r.timestamp_shift_same_sql, 0)
        self.assertEqual(r.timestamp_shift_different_sql, 1)
        self.assertEqual(
            r.timestamp_aliases_changed_sql,
            (("20261013000002", "20261013000001"),),
        )

    def test_same_version_with_different_sql_does_not_pass(self) -> None:
        a = item("20261013000001", "credit_sync", "select 1;")
        b = item("20261013000001", "credit_sync", "select 2;")
        r = reconcile([a], [b])
        self.assertEqual(r.same_version_different_sql, 1)
        self.assertEqual(r.same_version_changed_sql_versions, ("20261013000001",))
        self.assertEqual(r.status, "RECONCILIATION_REQUIRED")

    def test_unique_entries_are_preserved_in_report(self) -> None:
        prod = [item("20261013000001", "only_remote", "select 1;")]
        git = [item("20261013000002", "only_local", "select 2;")]
        r = reconcile(prod, git)
        self.assertEqual(r.timestamp_shift_candidates, 0)
        self.assertEqual(r.remote_only_examples, ("20261013000001",))
        self.assertEqual(r.git_only_examples, ("20261013000002",))
        self.assertEqual(r.remaining_remote_versions, ("20261013000001",))
        self.assertEqual(r.remaining_git_versions, ("20261013000002",))

    def test_rejects_sql_in_metadata_input(self) -> None:
        digest = "a" * 64
        with self.assertRaises(ValueError):
            parse_remote_metadata(f"20261013000001\tfoo\t{digest}\tselect * from profiles;")

    def test_rejects_duplicate_remote_versions(self) -> None:
        digest = "a" * 64
        with self.assertRaises(ValueError):
            parse_remote_metadata(
                f"20261013000001\tfoo\t{digest}\n"
                f"20261013000001\tbar\t{digest}\n"
            )

    def test_reads_migration_digest_without_exposing_body(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            f = Path(directory) / "20261013000001_example.sql"
            f.write_text("\n select 1; \n", encoding="utf-8")
            records = read_git_migrations(Path(directory))
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0], item("20261013000001", "example", "select 1;"))

    def test_rejects_ambiguous_local_versions(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / "20261013000001_first.sql").write_text("select 1;")
            (Path(directory) / "20261013000001_second.sql").write_text("select 2;")
            with self.assertRaises(ValueError):
                read_git_migrations(Path(directory))


if __name__ == "__main__":
    unittest.main()
