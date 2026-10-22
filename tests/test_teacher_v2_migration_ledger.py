import hashlib
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
DRIFT_SCRIPT = ROOT / "scripts" / "check_supabase_migration_drift.sh"

EMAIL_VERSION = "20261022230000"
PRODUCTION_EMAIL_VERSION = "20261022205054"
EMAIL_SHA256 = "f09b59cbc0b3a5b747776278ddd01e8d3eb90ddbc7ad7d931671e60df6b7660f"
QUESTION_BLOB_SHA = "729ac0534b63caa9762ee930e20f1e414a7ceeb0"


class TeacherV2MigrationLedgerTests(unittest.TestCase):
    def test_email_alias_sql_is_byte_equivalent_to_production_attestation(self):
        source = (MIGRATIONS / (EMAIL_VERSION + "_add_tuition_email_reminders.sql")).read_text()
        observed = hashlib.sha256(source.strip().encode("utf-8")).hexdigest()
        self.assertEqual(EMAIL_SHA256, observed)
        matcher = re.escape(
            f"{EMAIL_VERSION}|{PRODUCTION_EMAIL_VERSION}|"
            f"add_tuition_email_reminders|{EMAIL_SHA256}"
        )
        self.assertRegex(DRIFT_SCRIPT.read_text(), matcher)

    def test_historical_question_migration_is_immutable_and_pending(self):
        source = MIGRATIONS / "20261022202000_teacher_question_ratings_v2.sql"
        checksum = subprocess.run(
            ["git", "hash-object", str(source)],
            check=True, capture_output=True, text=True
        ).stdout.strip()
        self.assertEqual(QUESTION_BLOB_SHA, checksum)

        script = DRIFT_SCRIPT.read_text()
        self.assertIn("attest_pending_teacher_v2_migration", script)
        self.assertIn(QUESTION_BLOB_SHA, script)
        self.assertIn("version=\"$1\"", script)
        self.assertIn("[[ \"$version\" == '20261022202000' ]]", script)
        self.assertIn("get_teacher_question_rating_history_v2", script)
        self.assertIn("rate_teacher_conversation_question_v2", script)

    def test_unrecognized_late_or_changed_migration_still_fails_closed(self):
        script = DRIFT_SCRIPT.read_text()
        self.assertIn(
            'else\n          echo "::error::New migration ${new_version} must be newer',
            script,
        )
        self.assertIn("drift_found=true", script)
        self.assertIn("Production contains migration versions that are missing", script)
        self.assertIn("Migration identity differs between production and Git", script)

    def test_new_sql_is_isolated_and_worker_switch_remains_disabled(self):
        lifecycle = (
            MIGRATIONS / "20261022212500_academic_v2_auto_attendance_and_closure.sql"
        ).read_text()
        assert "enabled boolean not null default false" in lifecycle
        assert "if not coalesce(control.enabled, false)" in lifecycle
        assert "candidate.starts_at + interval '90 minutes' <= now()" in lifecycle
        assert "select private.run_teacher_v2_auto_finalizations();" in lifecycle

        rollout = (ROOT / "roteiro-da-aula-v2" / "app.js").read_text()
        for name in (
            "PRESENTATION_REGISTRATION_ENABLED",
            "QUESTION_RATINGS_ENABLED",
            "SESSION_LIFECYCLE_ENABLED",
        ):
            self.assertIn(f"const {name} = false;", rollout)


if __name__ == "__main__":
    unittest.main()
