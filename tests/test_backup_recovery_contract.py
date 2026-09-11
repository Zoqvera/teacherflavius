from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APPLICATION_CRONS = (
    "daily-data-retention-maintenance",
    "mercado-pago-chargeback-reconciliation",
    "mercado-pago-reconciliation",
    "operational-data-quality-health-check",
    "payment-alert-health-scan",
    "payment-financial-health-check",
    "sync-auto-makeup-slots-30-days",
    "system-health-watchdog",
    "system-synthetic-probe",
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
        self.assertIn("--cipher-algo AES256", script)
        self.assertIn("sha256sum --check manifest.sha256", script)
        self.assertIn('cd "$(dirname "$ENCRYPTED")"', script)
        self.assertIn('sha256sum "$(basename "$ENCRYPTED")"', script)

    def test_recovery_workflow_is_chained_to_successful_backup(self) -> None:
        workflow = self.read(".github/workflows/supabase-backup-recovery-test.yml")

        self.assertIn("workflow_run:", workflow)
        self.assertIn("Encrypted Supabase logical backup", workflow)
        self.assertIn("github.event.workflow_run.conclusion == 'success'", workflow)
        self.assertIn("actions: read", workflow)
        self.assertIn("actions/download-artifact@v4", workflow)
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
        self.assertIn(".cron_jobs | length == 9", script)

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

    def test_recovery_baseline_versions_every_application_cron(self) -> None:
        platform_config = self.read("supabase/baseline/30_platform_config.sql")

        for cron_name in APPLICATION_CRONS:
            self.assertIn(cron_name, platform_config)

        self.assertEqual(platform_config.count("perform cron.schedule"), 1)


if __name__ == "__main__":
    unittest.main()
