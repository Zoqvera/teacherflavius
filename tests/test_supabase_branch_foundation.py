"""Metadata-only foundation replay assessment contracts."""
from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import asdict
from pathlib import Path

from scripts.assess_supabase_branch_foundation import assess, main


class FoundationAssessmentTests(unittest.TestCase):
    def test_missing_core_migrations_block_replay(self) -> None:
        assessment = assess({
            "migration_count": 314,
            "profiles_creates": 0,
            "teacher_admins_creates": 0,
            "study_lesson_pages_creates": 1,
        })
        self.assertEqual(assessment.status, "POSSIBLE_MISSING_FOUNDATION")
        self.assertEqual(
            assessment.undeclared_foundations,
            ("public.profiles", "public.teacher_admins"),
        )
        self.assertFalse(assessment.dashboard_branch_replay_verified)
        self.assertFalse(assessment.github_branch_replay_verified)
        self.assertFalse(assessment.production_write_authorized)
        self.assertFalse(assessment.statements_exported)

    def test_found_declarations_do_not_certify_branch(self) -> None:
        assessment = assess({
            "migration_count": 3,
            "profiles_creates": 1,
            "teacher_admins_creates": 1,
            "study_lesson_pages_creates": 1,
        })
        self.assertEqual(assessment.status, "FOUNDATION_DECLARATIONS_DETECTED")
        self.assertEqual(assessment.undeclared_foundations, ())
        self.assertFalse(assessment.dashboard_branch_replay_verified)

    def test_rejects_untrusted_input_and_overcount(self) -> None:
        base = dict(
            migration_count=4,
            profiles_creates=1,
            teacher_admins_creates=1,
            study_lesson_pages_creates=1,
        )
        cases = [
            {**base, "migration_count": True},
            {**base, "teacher_admins_creates": -1},
            {**base, "profiles_creates": 5},
            {**base, "migration_statements": "do not export SQL"},
            {key: value for key, value in base.items() if key != "profiles_creates"},
        ]
        for payload in cases:
            with self.subTest(payload=payload):
                with self.assertRaises(ValueError):
                    assess(payload)

    def test_report_has_no_sql_or_private_data(self) -> None:
        report = asdict(assess({
            "migration_count": 2,
            "profiles_creates": 1,
            "teacher_admins_creates": 0,
            "study_lesson_pages_creates": 1,
        }))
        output = json.dumps(report)
        self.assertNotIn("statements", output)
        self.assertNotIn("auth.users", output)
        self.assertFalse(report["production_write_authorized"])

    def test_readonly_query_never_selects_sql_statements(self) -> None:
        query = (
            Path(__file__).resolve().parents[1]
            / "scripts/sql/supabase_branch_foundation_readonly.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("from supabase_migrations.schema_migrations", query)
        self.assertIn("json_build_object", query)
        self.assertNotIn("delete from", query)
        self.assertNotIn("update supabase_migrations", query)
        self.assertNotIn("select *", query)


if __name__ == "__main__":
    unittest.main()
