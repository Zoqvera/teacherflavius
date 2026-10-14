"""Guardrails for the repository-level Supabase preview preparation."""
from __future__ import annotations

import re
import tomllib
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "supabase/config.toml"
SEED = ROOT / "supabase/seed.sql"
GITIGNORE = ROOT / ".gitignore"


class RepositoryPreviewSafetyTests(unittest.TestCase):
    def test_config_is_valid_and_seed_is_disabled_until_bootstrap_is_fixed(self) -> None:
        config = tomllib.loads(CONFIG.read_text(encoding="utf-8"))
        self.assertEqual(config["project_id"], "teacherflavius-local-fixture")
        self.assertFalse(config["db"]["seed"]["enabled"])
        self.assertEqual(config["db"]["seed"]["sql_paths"], ["./seed.sql"])
        self.assertNotIn("remotes", config)

    def test_synthetic_seed_refuses_unsafe_databases(self) -> None:
        sql = SEED.read_text(encoding="utf-8").lower()
        self.assertIn("to_regclass('public.teacher_classes')", sql)
        self.assertIn("if exists (select 1 from public.teacher_classes)", sql)
        self.assertIn("or exists (select 1 from public.profiles)", sql)
        self.assertIn("or exists (select 1 from public.monthly_tuition)", sql)
        self.assertIn("if exists (select 1 from cron.job where active)", sql)
        self.assertIn("raise exception", sql)
        self.assertIn("makeup_slots_enabled", sql)

    def test_seed_contains_only_fictitious_group_and_individual_classes(self) -> None:
        sql = SEED.read_text(encoding="utf-8").lower()
        self.assertIn("970001", sql)
        self.assertIn("970002", sql)
        self.assertIn("quintet", sql)
        self.assertIn("individual", sql)
        for forbidden in (
            "auth.users", "service_role", "monthly_tuition (",
            "profiles (", "payment", "teacherflavius.com",
            "http://", "https://", "gen_random_uuid",
        ):
            self.assertNotIn(forbidden, sql)
        self.assertEqual(len(re.findall(r"'synthetic preview (?:quintet|individual)'", sql)), 2)

    def test_local_secrets_and_cli_artifacts_are_ignored(self) -> None:
        ignore = GITIGNORE.read_text(encoding="utf-8")
        for pattern in (".env", "supabase/.temp/", "supabase/.branches/"):
            self.assertIn(pattern, ignore)


if __name__ == "__main__":
    unittest.main()
