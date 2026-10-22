from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPLICATION_CRONS = (
    "auth-account-health-check",
    "daily-data-retention-maintenance",
    "mercado-pago-chargeback-reconciliation",
    "mercado-pago-reconciliation",
    "operational-data-quality-health-check",
    "payment-alert-health-scan",
    "payment-financial-health-check",
    "sync-auto-makeup-slots-30-days",
    "system-health-watchdog",
    "system-synthetic-probe",
    "web-push-notifications",
)


class BackupRecoveryContractTests(unittest.TestCase):
    def read(self, path: str) -> str:
        return (ROOT / path).read_text(encoding="utf-8")

    def test_backup_workflow_delegates_encrypted_backup_creation(self) -> None:
        workflow = self.read(".github/workflows/supabase-encrypted-backup.yml")
        script = self.read("scripts/create_encrypted_supabase_backup.sh")

        self.assertIn("bash scripts/create_encrypted_supabase_backup.sh", workflow)
        self.assertIn("actions/upload-artifact@v7", workflow)
        self.assertIn("supabase db dump", script)
        self.assertIn("recovery_manifest.sql", script)
        self.assertIn("capture_application_triggers", script)
        self.assertIn("export_application_triggers.sql", script)
        self.assertIn("application_triggers.sql", script)
        self.assertIn(".format_version == 3", script)
        self.assertIn("--cipher-algo AES256", script)
        self.assertIn("sha256sum --check manifest.sha256", script)
        self.assertIn('cd "$(dirname "$ENCRYPTED")"', script)
        self.assertIn('sha256sum "$(basename "$ENCRYPTED")"', script)

    def test_application_trigger_export_covers_managed_auth_and_event_triggers(self) -> None:
        exporter = self.read("supabase/recovery/export_application_triggers.sql")

        for marker in (
            "set search_path = pg_catalog;",
            "pg_get_triggerdef",
            "pg_event_trigger",
            "pn.nspname in ('public', 'private')",
            "CREATE EVENT TRIGGER",
            "quote_literal(tag)",
            "order by position, object_name",
        ):
            self.assertIn(marker, exporter)

    def test_application_triggers_are_restored_after_data_import(self) -> None:
        script = self.read("scripts/verify_supabase_backup_restore.sh")
        main = script.split("main() {", maxsplit=1)[1]

        self.assertLess(
            main.index("restore_logical_backup"),
            main.index("restore_application_triggers"),
        )
        self.assertLess(
            main.index("restore_application_triggers"),
            main.index("capture_restored_manifest_and_disable_crons"),
        )
        self.assertIn('cat "$RECOVERY_DIR/application_triggers.sql"', script)
        self.assertIn(
            "alter function public.rls_auto_enable() owner to supabase_admin;",
            script,
        )
        self.assertLess(
            script.index("alter function public.rls_auto_enable() owner to supabase_admin;"),
            script.index('cat "$RECOVERY_DIR/application_triggers.sql"'),
        )
        self.assertIn("| run_recovery_admin_sql", script)

    def test_backup_runs_after_recovery_code_merges(self) -> None:
        workflow = self.read(".github/workflows/supabase-encrypted-backup.yml")
        self.assertIn("push:", workflow)
        self.assertIn("- main", workflow)
        self.assertIn("'supabase/recovery/**'", workflow)

    def test_recovery_workflow_is_chained_to_successful_backup(self) -> None:
        workflow = self.read(".github/workflows/supabase-backup-recovery-test.yml")

        self.assertIn("workflow_run:", workflow)
        self.assertIn("Encrypted Supabase logical backup", workflow)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", workflow)
        self.assertIn("actions: read", workflow)
        self.assertIn("actions/download-artifact@v8", workflow)
        self.assertIn("run-id: ${{ env.BACKUP_RUN_ID }}", workflow)
        self.assertIn("bash scripts/verify_supabase_backup_restore.sh", workflow)

    def test_recovery_workflow_uses_runner_context_only_after_runner_starts(self) -> None:
        workflow = self.read(".github/workflows/supabase-backup-recovery-test.yml")
        job_header, _steps = workflow.split("\n    steps:\n", maxsplit=1)

        self.assertNotIn("${{ runner.", job_header)
        self.assertIn(
            "path: ${{ runner.temp }}/teacherflavius-backup-artifact",
            workflow,
        )
        self.assertIn(
            "BACKUP_ARTIFACT_DIR: ${{ runner.temp }}/teacherflavius-backup-artifact",
            workflow,
        )

    def test_recovery_manifest_covers_auth_catalog_storage_and_crons(self) -> None:
        manifest = self.read("supabase/recovery/recovery_manifest.sql")

        for marker in (
            "auth.users",
            "auth.identities",
            "auth.mfa_factors",
            "catalog_fingerprint",
            "storage.buckets",
            "storage.objects",
        ):
            self.assertIn(marker, manifest)

        for cron_name in APPLICATION_CRONS:
            self.assertIn(cron_name, manifest)

    def test_restore_script_follows_recovery_contract(self) -> None:
        script = self.read("scripts/verify_supabase_backup_restore.sh")

        for marker in (
            "sha256sum --check",
            "--decrypt",
            "manifest.sha256",
            "supabase start",
            "--single-transaction",
            "SET session_replication_role = replica",
            "history_schema.sql",
            "history_data.sql",
            "30_platform_config.sql",
            "recovery_manifest.sql",
            "diff -u",
            "rto_exercise_seconds",
            "rpo_design_hours",
        ):
            self.assertIn(marker, script)

        self.assertIn(".storage.buckets == 0 and .storage.objects == 0", script)
        self.assertIn(".cron_jobs | length == 11", script)
        self.assertIn(".format_version == 3", script)
        self.assertIn("restore_application_triggers", script)
        self.assertIn("application_triggers.sql", script)

    def test_restore_script_uses_local_admin_for_cron_recovery(self) -> None:
        script = self.read("scripts/verify_supabase_backup_restore.sh")

        self.assertIn('LOCAL_DB_CONTAINER="supabase_db_$(basename "$STACK_DIR")"', script)
        self.assertIn("-U supabase_admin", script)
        self.assertIn("update cron.job set active = false", script)
        self.assertIn("| run_recovery_admin_sql > \"$RESTORED_MANIFEST\"", script)

    def test_restore_script_selects_latest_backup_from_rerun_artifacts(self) -> None:
        script = self.read("scripts/verify_supabase_backup_restore.sh")

        self.assertIn("select_latest_backup_payload", script)
        self.assertIn("-name 'teacherflavius-*.tar.gz.gpg'", script)
        self.assertIn("LC_ALL=C sort -r", script)
        self.assertIn("sed -n '1p'", script)

    def test_presentation_rehearsal_runs_only_after_validated_backup_restore(self) -> None:
        script = self.read("scripts/verify_supabase_backup_restore.sh")
        sql = self.read(
            "tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql"
        )
        main = script.split("main() {", maxsplit=1)[1]

        self.assertLess(main.index("compare_recovery_state"),
                        main.index("rehearse_presentation_schema_against_restored_backup"))
        self.assertLess(main.index("rehearse_presentation_schema_against_restored_backup"),
                        main.index("write_report"))
        self.assertIn("set local lock_timeout", script)
        self.assertIn("set local statement_timeout", script)
        self.assertIn("20261017133000_lesson_presentations_stage1.sql", script)
        self.assertIn("20261017144500_lesson_presentation_views_stage3.sql", script)
        self.assertIn("lesson_presentations_stage5_restored_backup_checks.sql", script)
        self.assertIn("echo 'begin;'", script)
        self.assertIn("echo 'rollback;'", script)
        self.assertIn("echo \"set local lock_timeout", script)
        self.assertNotIn("printf 'begin;", script)
        self.assertNotIn("printf 'rollback;", script)
        self.assertIn("RESTORED_SCHEMA_UNCHANGED", script)
        self.assertIn("LESSON_PRESENTATIONS_STAGE5_BACKUP_REHEARSAL_PASSED", sql)
        self.assertIn("pg_catalog.pg_policies", sql)
        self.assertIn("relrowsecurity", sql)
        self.assertIn("has_column_privilege", sql)
        self.assertNotIn("insert into", sql.lower())
        self.assertNotIn("delete from", sql.lower())
        self.assertNotIn("update public.", sql.lower())

    def test_recovery_supports_populated_presentation_tables_read_only(self) -> None:
        script = self.read("scripts/verify_supabase_backup_restore.sh")
        sql = self.read(
            "tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql"
        )

        self.assertIn("presentation_state", script)
        self.assertIn("if [[ \"$presentation_state\" == 'complete' ]]", script)
        self.assertIn("begin transaction read only;", script)
        self.assertIn("Restored presentation schema is partially present", script)
        self.assertIn("return 0", script)
        self.assertIn(
            "teacherflavius.recovery_expect_empty_presentation_tables",
            script,
        )
        self.assertIn(
            "current_setting('teacherflavius.recovery_expect_empty_presentation_tables', true)",
            sql,
        )
        self.assertLess(
            script.index("compare_recovery_state"),
            script.index("rehearse_presentation_schema_against_restored_backup"),
        )

    def test_backup_workflow_is_retriggered_by_stage5_homologation(self) -> None:
        workflow = self.read(".github/workflows/supabase-encrypted-backup.yml")
        self.assertIn("'docs/apresentacoes-licoes-etapa5.md'", workflow)
        self.assertIn("Encrypted Supabase logical backup", workflow)

    def test_recovery_baseline_versions_every_application_cron(self) -> None:
        platform_config = self.read("supabase/baseline/30_platform_config.sql")

        for cron_name in APPLICATION_CRONS:
            self.assertIn(cron_name, platform_config)

        self.assertEqual(platform_config.count("perform cron.schedule"), 1)


if __name__ == "__main__":
    unittest.main()
