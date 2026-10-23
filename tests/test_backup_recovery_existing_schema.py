"""Regression tests for backup restores with already-installed presentation tables."""
from __future__ import annotations

import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
RESTORE = (ROOT / "scripts/verify_supabase_backup_restore.sh").read_text()
CHECKS = (ROOT / "tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql").read_text()

START = RESTORE.index("rehearse_presentation_schema_against_restored_backup() {")
END = RESTORE.index("\nwrite_report() {", START)
FUNCTION = RESTORE[START:END]


class ExistingSchemaBackupRecoveryTests(unittest.TestCase):
    def simulate(self, state: str) -> tuple[subprocess.CompletedProcess[str], str]:
        with tempfile.TemporaryDirectory() as temporary:
            temp = pathlib.Path(temporary)
            script = """#!/usr/bin/env bash
set -euo pipefail
psql() {
  local args=" $* "
  if [[ "$args" == *" -c "* ]]; then
    if [[ "$args" == *"then 'installed'"* ]]; then
      echo "$TEST_CATALOG_STATE"
    else
      echo 'RESTORED_SCHEMA_UNCHANGED'
    fi
    return
  fi
  cat > "$RUNNER_TEMP/rehearsed-input.sql"
  echo 'LESSON_PRESENTATIONS_STAGE5_BACKUP_REHEARSAL_PASSED'
}
"""
            script += FUNCTION + "\nrehearse_presentation_schema_against_restored_backup\n"
            env = os.environ.copy()
            env.update({
                "LOCAL_DB_URL": "postgresql://local-only/fixture",
                "GITHUB_WORKSPACE": str(ROOT),
                "RUNNER_TEMP": str(temp),
                "TEST_CATALOG_STATE": state,
            })
            result = subprocess.run(
                ["bash", "-c", script],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            payload = temp / "rehearsed-input.sql"
            return result, payload.read_text() if payload.exists() else ""

    def test_installed_schema_is_verified_read_only_without_create_table(self) -> None:
        result, executed = self.simulate("installed")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("begin read only;", executed)
        self.assertIn("rollback;", executed)
        self.assertIn("pg_catalog.pg_policies", executed)
        self.assertNotIn("create table public.lesson_presentations", executed.lower())
        self.assertNotIn("set local teacherflavius.presentation_rehearsal_created", executed)

    def test_older_backup_rehearses_creation_only_with_rollback(self) -> None:
        result, executed = self.simulate("absent")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("begin;", executed)
        self.assertIn("create table public.lesson_presentations", executed.lower())
        self.assertIn("set local teacherflavius.presentation_rehearsal_created = 'true'", executed)
        self.assertIn("rollback;", executed)

    def test_partial_schema_stops_without_attempting_recreation(self) -> None:
        result, executed = self.simulate("partial")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("partially installed", result.stdout + result.stderr)
        self.assertEqual(executed, "")

    def test_existing_students_do_not_need_empty_presentation_tables(self) -> None:
        self.assertIn(
            "current_setting('teacherflavius.presentation_rehearsal_created', true) = 'true'",
            CHECKS,
        )
        self.assertIn("lesson_presentation_versions", CHECKS)
        self.assertIn("relrowsecurity", CHECKS)
        self.assertIn("has_column_privilege", CHECKS)
        self.assertIn("policy_count <> 6", CHECKS)
        self.assertIn("trigger_count <> 2", CHECKS)


if __name__ == "__main__":
    unittest.main()
