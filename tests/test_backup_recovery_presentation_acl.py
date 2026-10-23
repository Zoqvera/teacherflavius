"""Application presentation ACLs must survive encrypted Supabase backup/restore."""
from __future__ import annotations

import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
DUMP = (ROOT / "scripts/create_encrypted_supabase_backup.sh").read_text()
RESTORE = (ROOT / "scripts/verify_supabase_backup_restore.sh").read_text()
EXPORT = (ROOT / "supabase/recovery/export_presentation_permissions.sql").read_text()

EXPECTED_SQL = (
    "REVOKE ALL PRIVILEGES ON TABLE public.lesson_presentation_versions FROM PUBLIC, anon, authenticated;",
    "REVOKE ALL PRIVILEGES ON TABLE public.lesson_presentation_views FROM PUBLIC, anon, authenticated;",
    "REVOKE ALL PRIVILEGES ON TABLE public.lesson_presentations FROM PUBLIC, anon, authenticated;",
    "GRANT SELECT ON TABLE public.lesson_presentation_versions TO authenticated;",
    "GRANT SELECT ON TABLE public.lesson_presentation_views TO authenticated;",
    "GRANT INSERT, SELECT, UPDATE ON TABLE public.lesson_presentations TO authenticated;",
    "GRANT INSERT (presentation_id) ON TABLE public.lesson_presentation_views TO authenticated;",
    "GRANT INSERT (revision_number) ON TABLE public.lesson_presentation_views TO authenticated;",
    "GRANT INSERT (teacher_id) ON TABLE public.lesson_presentation_views TO authenticated;",
)


class PresentationAclRecoveryContracts(unittest.TestCase):
    def test_backup_collects_live_grants_and_encrypts_them(self) -> None:
        self.assertIn("export_presentation_permissions.sql", DUMP)
        self.assertIn('> "$BACKUP_DIR/presentation_permissions.sql"', DUMP)
        self.assertIn("presentation_permissions.sql \\", DUMP)
        self.assertLess(
            DUMP.index("  capture_presentation_permissions\n"),
            DUMP.index("  encrypt_backup\n"),
        )
        for marker in (
            "pg_catalog.aclexplode",
            "pg_catalog.pg_attribute",
            "pg_catalog.pg_roles",
            "lesson_presentation_versions",
            "lesson_presentation_views",
            "lesson_presentations",
            "format(",
            "REVOKE ALL PRIVILEGES",
        ):
            self.assertIn(marker, EXPORT)

    def test_recovery_applies_encrypted_grants_before_verifying_manifest(self) -> None:
        self.assertIn('manifest.sha256', RESTORE)
        self.assertIn('restore_presentation_permissions()', RESTORE)
        self.assertIn('--file "$RECOVERY_DIR/presentation_permissions.sql"', RESTORE)
        main = RESTORE.split("main() {", maxsplit=1)[1]
        self.assertLess(
            main.index("  restore_logical_backup"),
            main.index("  restore_presentation_permissions"),
        )
        self.assertLess(
            main.index("  restore_presentation_permissions"),
            main.index("  capture_restored_manifest_and_disable_crons"),
        )
        self.assertLess(
            main.index("  compare_recovery_state"),
            main.index("  rehearse_presentation_schema_against_restored_backup"),
        )

    def test_very_strict_acl_allowlist_blocks_additional_sql_and_missing_grants(self) -> None:
        matcher = re.search(
            r"if ! awk '(.*?)' \"\$RECOVERY_DIR/presentation_permissions.sql\";",
            RESTORE,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(matcher)
        awk_program = matcher.group(1)
        with tempfile.TemporaryDirectory() as temporary:
            file = pathlib.Path(temporary) / "grants.sql"

            def approved(lines: tuple[str, ...]) -> bool:
                file.write_text("\n".join(lines) + "\n")
                checked = subprocess.run(
                    ["awk", awk_program, str(file)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                return checked.returncode == 0

            self.assertTrue(approved(EXPECTED_SQL))
            self.assertFalse(approved(EXPECTED_SQL[:-1]))
            self.assertFalse(approved(EXPECTED_SQL + (
                "GRANT SELECT ON TABLE public.lesson_presentations TO anon;",
            )))
            self.assertFalse(approved(EXPECTED_SQL + (
                "DROP TABLE public.lesson_presentations;",
            )))

    def test_both_workflows_remain_read_only_on_production_database(self) -> None:
        self.assertIn('psql "$SUPABASE_DB_URL" -X -qAt', DUMP)
        self.assertIn('psql "$LOCAL_DB_URL" -X --no-password', RESTORE)
        self.assertNotIn('psql "$SUPABASE_DB_URL" -X --no-password --single-transaction', RESTORE)
        self.assertNotIn("supabase db reset --linked", RESTORE)
        self.assertNotIn("service_role_key", EXPORT.lower())


if __name__ == "__main__":
    unittest.main()
