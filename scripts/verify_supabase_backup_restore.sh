#!/usr/bin/env bash
set -euo pipefail

APPLICATION_CRONS_SQL="'daily-data-retention-maintenance','mercado-pago-chargeback-reconciliation','mercado-pago-reconciliation','payment-alert-health-scan','payment-financial-health-check','sync-auto-makeup-slots-30-days','system-health-watchdog','system-synthetic-probe'"
STACK_STARTED=false

require_environment() {
  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo '::error::Missing repository secret BACKUP_ENCRYPTION_PASSPHRASE.'
    exit 1
  fi

  if [ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -lt 32 ]; then
    echo '::error::BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters.'
    exit 1
  fi

  if [ -z "${BACKUP_ARTIFACT_DIR:-}" ] || [ ! -d "$BACKUP_ARTIFACT_DIR" ]; then
    echo '::error::BACKUP_ARTIFACT_DIR is missing or invalid.'
    exit 1
  fi

  if [ -z "${RUNNER_TEMP:-}" ] || [ -z "${GITHUB_WORKSPACE:-}" ]; then
    echo '::error::This script must run inside GitHub Actions.'
    exit 1
  fi
}

prepare_paths() {
  ENCRYPTED="$(find "$BACKUP_ARTIFACT_DIR" -maxdepth 1 -type f -name '*.tar.gz.gpg' -print -quit)"
  CHECKSUM="${ENCRYPTED}.sha256"
  RECOVERY_ARCHIVE="$RUNNER_TEMP/teacherflavius-recovery.tar.gz"
  RECOVERY_DIR="$RUNNER_TEMP/teacherflavius-recovery"
  STACK_DIR="$RUNNER_TEMP/teacherflavius-recovery-stack"
  RESTORED_MANIFEST="$RUNNER_TEMP/restored-recovery-manifest.json"
  EXPECTED_NORMALIZED="$RUNNER_TEMP/expected-recovery-manifest.json"
  ACTUAL_NORMALIZED="$RUNNER_TEMP/actual-recovery-manifest.json"
  REPORT_PATH="$RUNNER_TEMP/recovery-verification-report.json"

  if [ -z "$ENCRYPTED" ] || [ ! -f "$CHECKSUM" ]; then
    echo '::error::Encrypted backup payload or checksum is missing.'
    exit 1
  fi
}

cleanup() {
  set +e
  if [ "$STACK_STARTED" = true ] && [ -d "$STACK_DIR" ]; then
    (
      cd "$STACK_DIR"
      supabase stop --no-backup
    ) >/dev/null 2>&1
  fi
  rm -rf -- \
    "${RECOVERY_ARCHIVE:-}" \
    "${RECOVERY_DIR:-}" \
    "${STACK_DIR:-}" \
    "${RESTORED_MANIFEST:-}" \
    "${EXPECTED_NORMALIZED:-}" \
    "${ACTUAL_NORMALIZED:-}"
}

verify_and_decrypt_artifact() {
  (
    cd "$BACKUP_ARTIFACT_DIR"
    sha256sum --check "$(basename "$CHECKSUM")"
  )

  mkdir -p "$RECOVERY_DIR"
  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | \
    gpg \
      --batch \
      --yes \
      --pinentry-mode loopback \
      --passphrase-fd 0 \
      --decrypt \
      --output "$RECOVERY_ARCHIVE" \
      "$ENCRYPTED"

  tar -xzf "$RECOVERY_ARCHIVE" -C "$RECOVERY_DIR"
  (
    cd "$RECOVERY_DIR"
    sha256sum --check manifest.sha256
  )

  jq -e '
    .format_version == 2
    and (.critical_row_counts | type == "object")
    and (.catalog_fingerprint | type == "object")
    and (.cron_jobs | length == 8)
  ' "$RECOVERY_DIR/recovery_manifest.json" >/dev/null

  if ! jq -e '.storage.buckets == 0 and .storage.objects == 0' "$RECOVERY_DIR/recovery_manifest.json" >/dev/null; then
    echo '::error::Supabase Storage contains buckets or objects. Database-only disaster recovery is no longer complete.'
    exit 1
  fi
}

start_disposable_stack() {
  RECOVERY_STARTED_EPOCH="$(date +%s)"
  rm -rf "$STACK_DIR"
  mkdir -p "$STACK_DIR"
  (
    cd "$STACK_DIR"
    supabase init
    supabase start
  )
  STACK_STARTED=true

  LOCAL_DB_URL="$({
    cd "$STACK_DIR"
    supabase status -o env
  } | sed -n 's/^DB_URL="\(.*\)"$/\1/p' | head -n 1)"

  if [ -z "$LOCAL_DB_URL" ]; then
    echo '::error::Could not resolve disposable Supabase database URL.'
    exit 1
  fi
}

restore_logical_backup() {
  psql \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "$RECOVERY_DIR/roles.sql" \
    --file "$RECOVERY_DIR/schema.sql" \
    --command 'SET session_replication_role = replica' \
    --file "$RECOVERY_DIR/data.sql" \
    --dbname "$LOCAL_DB_URL"

  psql "$LOCAL_DB_URL" \
    --variable ON_ERROR_STOP=1 \
    --command 'drop schema if exists supabase_migrations cascade;'

  psql \
    --single-transaction \
    --variable ON_ERROR_STOP=1 \
    --file "$RECOVERY_DIR/history_schema.sql" \
    --file "$RECOVERY_DIR/history_data.sql" \
    --dbname "$LOCAL_DB_URL"
}

capture_restored_manifest_and_disable_crons() {
  psql "$LOCAL_DB_URL" -At --variable ON_ERROR_STOP=1 <<SQL
begin;
\i $GITHUB_WORKSPACE/supabase/baseline/30_platform_config.sql
\o $RESTORED_MANIFEST
\i $GITHUB_WORKSPACE/supabase/recovery/recovery_manifest.sql
\o
update cron.job set active = false where jobname in ($APPLICATION_CRONS_SQL);
commit;
SQL
}

compare_recovery_state() {
  jq -S 'del(.captured_at)' \
    "$RECOVERY_DIR/recovery_manifest.json" \
    > "$EXPECTED_NORMALIZED"
  jq -S 'del(.captured_at)' \
    "$RESTORED_MANIFEST" \
    > "$ACTUAL_NORMALIZED"

  echo 'Expected recovery fingerprint:'
  cat "$EXPECTED_NORMALIZED"
  echo 'Restored recovery fingerprint:'
  cat "$ACTUAL_NORMALIZED"
  diff -u "$EXPECTED_NORMALIZED" "$ACTUAL_NORMALIZED"
}

write_report() {
  local finished_epoch duration verified_at captured_at
  finished_epoch="$(date +%s)"
  duration="$((finished_epoch - RECOVERY_STARTED_EPOCH))"
  verified_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  captured_at="$(jq -r '.captured_at' "$RECOVERY_DIR/recovery_manifest.json")"

  jq -n \
    --arg status 'passed' \
    --arg verified_at "$verified_at" \
    --arg backup_captured_at "$captured_at" \
    --argjson rto_exercise_seconds "$duration" \
    --argjson rpo_design_hours 24 \
    --argjson manifest_format_version 2 \
    '{
      status: $status,
      verified_at: $verified_at,
      backup_captured_at: $backup_captured_at,
      rto_exercise_seconds: $rto_exercise_seconds,
      rpo_design_hours: $rpo_design_hours,
      manifest_format_version: $manifest_format_version
    }' > "$REPORT_PATH"

  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    {
      echo "report_path=$REPORT_PATH"
      echo "rto_exercise_seconds=$duration"
      echo "backup_captured_at=$captured_at"
    } >> "$GITHUB_OUTPUT"
  fi

  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
    {
      echo '## Supabase disaster-recovery exercise'
      echo
      echo "- Result: passed"
      echo "- Backup captured at: $captured_at"
      echo "- Disposable restore + verification: ${duration}s"
      echo '- Backup cadence / design RPO: 24h'
      echo '- Storage coverage guard: passed (0 buckets, 0 objects)'
      echo
      echo 'The measured duration is a laboratory restore exercise, not a guarantee of full production cutover time.'
    } >> "$GITHUB_STEP_SUMMARY"
  fi
}

main() {
  require_environment
  prepare_paths
  trap cleanup EXIT
  verify_and_decrypt_artifact
  start_disposable_stack
  restore_logical_backup
  capture_restored_manifest_and_disable_crons
  compare_recovery_state
  write_report
}

main "$@"
