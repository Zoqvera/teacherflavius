"""Safety contracts for the disposable CLI-native Supabase migration replay."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.prepare_supabase_cli_replay import (
    ASSERTION_FILENAME,
    BOOTSTRAP_FILENAME,
    STOP_CRON,
    SEED_RELATIVE_PATH,
    assert_safe_paths,
    stage_replay,
)


class PreviewReplayFixtureTests(unittest.TestCase):
    def setUp(self) -> None:
        self.repository = Path(__file__).resolve().parents[1]
        self.fixture = tempfile.TemporaryDirectory()
        self.addCleanup(self.fixture.cleanup)
        self.staging = Path(self.fixture.name) / "staged-cli"
        (self.staging / "supabase" / "migrations").mkdir(parents=True)
        (self.staging / "supabase" / "config.toml").write_text(
            'project_id = "test-disposable-replay"\n', encoding="utf-8"
        )

    def test_genuine_migration_files_are_only_generated_in_temporary_staging(self) -> None:
        report = stage_replay(self.repository, self.staging)
        paths = sorted((self.staging / "supabase/migrations").glob("*.sql"))
        self.assertEqual([path.name for path in paths], [BOOTSTRAP_FILENAME, ASSERTION_FILENAME])
        self.assertEqual(report["migration_versions"], ["20261013000000", "20261013000001"])
        self.assertTrue(report["cron_disabled_in_migration"])
        self.assertIn(
            "enabled = true",
            (self.staging / "supabase/config.toml").read_text(encoding="utf-8"),
        )
        self.assertNotIn(
            "enabled = true",
            (self.repository / "supabase/config.toml").read_text(encoding="utf-8"),
        )
        self.assertTrue(
            paths[0].read_text().rstrip().endswith(STOP_CRON.strip())
        )
        self.assertIn("if to_regclass('public.profiles') is null", paths[1].read_text())
        self.assertEqual(report["reviewed_overlays"], 80)
        self.assertNotIn("service_role", (self.staging / "supabase/seed.sql").read_text())

    def test_seed_only_contains_two_test_classes_and_no_real_accounts(self) -> None:
        synthetic_seed = (self.repository / SEED_RELATIVE_PATH).read_text(encoding="utf-8")
        self.assertIn("970001", synthetic_seed)
        self.assertIn("970002", synthetic_seed)
        self.assertIn("quintet", synthetic_seed)
        self.assertIn("individual", synthetic_seed)
        self.assertNotIn("auth.users", synthetic_seed)
        self.assertNotIn("insert into public.monthly_tuition", synthetic_seed)
        self.assertNotIn("teacherflavius.com", synthetic_seed)
        self.assertIn("or exists (select 1 from public.profiles)", synthetic_seed)
        self.assertIn("if exists (select 1 from cron.job where active)", synthetic_seed)
        self.assertIn("raise exception", synthetic_seed)
        stage_replay(self.repository, self.staging)
        self.assertEqual(
            (self.staging / "supabase/seed.sql").read_text(encoding="utf-8"),
            synthetic_seed,
        )

    def test_protects_git_checkout_and_parent_directories(self) -> None:
        with self.assertRaises(ValueError):
            assert_safe_paths(self.repository, self.repository)
        with self.assertRaises(ValueError):
            assert_safe_paths(self.repository, self.repository / "supabase" / "migrations")
        with self.assertRaises(ValueError):
            assert_safe_paths(self.repository, self.repository.parent)

    def test_rejects_existing_staged_migrations_and_seeds(self) -> None:
        (self.staging / "supabase/migrations/existing.sql").write_text("select 1;")
        with self.assertRaisesRegex(ValueError, "existing SQL migrations"):
            stage_replay(self.repository, self.staging)

    def test_rejects_missing_cli_configuration(self) -> None:
        (self.staging / "supabase/config.toml").unlink()
        with self.assertRaisesRegex(ValueError, "Initialize"):
            stage_replay(self.repository, self.staging)

    def test_uses_existing_reviewed_canonical_compiler(self) -> None:
        stage_replay(self.repository, self.staging)
        sql = (self.staging / "supabase/migrations" / BOOTSTRAP_FILENAME).read_text()
        self.assertIn("create table public.profiles", sql)
        self.assertIn("private.lesson_credit_plan_exceptions", sql)
        self.assertIn("perform cron.alter_job(owned_job.jobid, active := false)", sql)
        report = json.loads((self.staging / "artifacts/cli-replay.json").read_text())
        self.assertEqual(report["mode"], "isolated-cli-replay-only")
        self.assertFalse(report["production_ledger_mutated"])


if __name__ == "__main__":
    unittest.main()
