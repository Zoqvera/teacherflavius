#!/usr/bin/env bash
set -euo pipefail

APPLICATION_CRONS_SQL="'auth-account-health-check','daily-data-retention-maintenance','mercado-pago-chargeback-reconciliation','mercado-pago-reconciliation','operational-data-quality-health-check','payment-alert-health-scan','payment-financial-health-check','sync-auto-makeup-slots-30-days','web-push-notifications','system-health-watchdog','system-synthetic-probe'"
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

select_latest_backup_payload() {
  local encrypted_name

  encrypted_name="$(
    find "$BACKUP_ARTIFACT_DIR" \
      -maxdepth 1 \
      -type f \
      -name 'teacherflavius-*.tar.gz.gpg' \
      -printf '%f\n' \
      | LC_ALL=C sort -r \
      | sed -n '1p'
  )"

  if [ -z "$encrypted_name" ]; then
    echo '::error::Encrypted backup payload is missing.'
    exit 1
  fi

  ENCRYPTED="$BACKUP_ARTIFACT_DIR/$encrypted_name"
  CHECKSUM="${ENCRYPTED}.sha256"

  if [ ! -f "$CHECKSUM" ]; then
    echo '::error::Encrypted backup checksum is missing.'
    exit 1
  fi
}

prepare_paths() {
  select_latest_backup_payload
  RECOVERY_ARCHIVE="$RUNNER_TEMP/teacherflavius-recovery.tar.gz"
  RECOVERY_DIR="$RUNNER_TEMP/teacherflavius-recovery"
  STACK_DIR="$RUNNER_TEMP/teacherflavius-recovery-stack"
  RESTORED_MANIFEST="$RUNNER_TEMP/restored-recovery-manifest.json"
  EXPECTED_NORMALIZED="$RUNNER_TEMP/expected-recovery-manifest.json"
  ACTUAL_NORMALIZED="$RUNNER_TEMP/actual-recovery-manifest.json"
  REPORT_PATH="$RUNNER_TEMP/recovery-verification-report.json"
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
    .format_version == 3
    and (.critical_row_counts | type == "object")
    and (.catalog_fingerprint | type == "object")
    and (.cron_jobs | length == 11)
  ' "$RECOVERY_DIR/recovery_manifest.json" >/dev/null

  if [ ! -s "$RECOVERY_DIR/application_triggers.sql" ]; then
    echo '::error::Application trigger definitions are absent from the backup archive.'
    exit 1
  fi

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

  LOCAL_DB_CONTAINER="supabase_db_$(basename "$STACK_DIR")"
  if ! docker inspect "$LOCAL_DB_CONTAINER" >/dev/null 2>&1; then
    echo '::error::Could not resolve disposable Supabase database container.'
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

restore_application_triggers() {
  # The local supabase_admin role is required for CREATE EVENT TRIGGER.
  # Restore these only after all data has been imported, so Auth triggers
  # cannot accidentally mutate student profiles during the import.
  {
    echo 'begin;'
    # Local Supabase restores public.rls_auto_enable() with a non-superuser
    # owner. PostgreSQL requires a superuser-owned callback when a superuser
    # recreates an event trigger. Reassign ownership ONLY in this disposable
    # database; the encrypted backup and production remain unchanged.
    echo 'alter function public.rls_auto_enable() owner to supabase_admin;'
    cat "$RECOVERY_DIR/application_triggers.sql"
    echo 'commit;'
  } | run_recovery_admin_sql
}

run_recovery_admin_sql() {
  docker exec -i "$LOCAL_DB_CONTAINER" \
    psql \
      -U supabase_admin \
      -d postgres \
      -qAt \
      --set ON_ERROR_STOP=1
}

capture_restored_manifest_and_disable_crons() {
  {
    echo 'begin;'
    cat "$GITHUB_WORKSPACE/supabase/baseline/30_platform_config.sql"
    cat "$GITHUB_WORKSPACE/supabase/recovery/recovery_manifest.sql"
    printf 'update cron.job set active = false where jobname in (%s);\n' "$APPLICATION_CRONS_SQL"
    echo 'commit;'
  } | run_recovery_admin_sql > "$RESTORED_MANIFEST"
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

rehearse_presentation_schema_against_restored_backup() {
  # Backup schema may already contain the application tables and real student
  # presentations. Never replay CREATE TABLE against an existing catalog.
  local rehearsal_log="$RUNNER_TEMP/lesson-presentation-stage5-rehearsal.log"
  local catalog_state

  catalog_state="$(psql "$LOCAL_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c "
    select case
      when to_regclass('public.lesson_presentations') is not null
       and to_regclass('public.lesson_presentation_versions') is not null
       and to_regclass('public.lesson_presentation_views') is not null
        then 'installed'
      when to_regclass('public.lesson_presentations') is null
       and to_regclass('public.lesson_presentation_versions') is null
       and to_regclass('public.lesson_presentation_views') is null
        then 'absent'
      else 'partial'
    end;
  ")"

  case "$catalog_state" in
    installed)
      # Existing production data must be preserved. Validate actual grants,
      # policies, RLS and triggers in a READ-ONLY transaction.
      {
        echo 'begin read only;'
        echo "set local statement_timeout = '30s';"
        cat "$GITHUB_WORKSPACE/tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql"
        echo 'rollback;'
      } | psql "$LOCAL_DB_URL" -X -qAt -v ON_ERROR_STOP=1 > "$rehearsal_log"
      echo 'Existing presentation catalog: validated without reapplying DDL.'
      ;;
    absent)
      # Older backups: rehearse both historical migrations transactionally.
      {
        echo 'begin;'
        echo "set local lock_timeout = '5s';"
        echo "set local statement_timeout = '30s';"
        echo "set local teacherflavius.presentation_rehearsal_created = 'true';"
        cat "$GITHUB_WORKSPACE/supabase/migrations/20261017133000_lesson_presentations_stage1.sql"
        cat "$GITHUB_WORKSPACE/supabase/migrations/20261017144500_lesson_presentation_views_stage3.sql"
        cat "$GITHUB_WORKSPACE/tests/fixtures/lesson_presentations_stage5_restored_backup_checks.sql"
        echo 'rollback;'
      } | psql "$LOCAL_DB_URL" -X -qAt -v ON_ERROR_STOP=1 > "$rehearsal_log"

      local post_rollback
      post_rollback="$(psql "$LOCAL_DB_URL" -X -qAt -v ON_ERROR_STOP=1 -c \
        "select case when
          to_regclass('public.lesson_presentations') is null
          and to_regclass('public.lesson_presentation_versions') is null
          and to_regclass('public.lesson_presentation_views') is null
        then 'RESTORED_SCHEMA_UNCHANGED' else 'REHEARSAL_LEFT_OBJECTS' end;")"

      if [[ "$post_rollback" != 'RESTORED_SCHEMA_UNCHANGED' ]]; then
        echo '::error::Presentation rehearsal changed the disposable restore.'
        exit 1
      fi

      echo 'Presentation migrations: verified on older restored catalog and rolled back.'
      ;;
    *)
      echo '::error::Restored presentation schema is partially installed or inconsistent.'
      exit 1
      ;;
  esac

  if ! grep -Fxq 'LESSON_PRESENTATIONS_STAGE5_BACKUP_REHEARSAL_PASSED' "$rehearsal_log"; then
    echo '::error::Presentation catalog security was not verified after backup restore.'
    exit 1
  fi
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
    --argjson manifest_format_version 3 \
    --arg presentation_schema_rehearsal 'passed' \
    '{
      status: $status,
      verified_at: $verified_at,
      backup_captured_at: $backup_captured_at,
      rto_exercise_seconds: $rto_exercise_seconds,
      rpo_design_hours: $rpo_design_hours,
      manifest_format_version: $manifest_format_version,
      presentation_schema_rehearsal: $presentation_schema_rehearsal
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
      echo '- Application Auth/event triggers: restored and compared against production'
      echo '- Presentation migration DDL and RLS: passed in restored catalog, rolled back'
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
  restore_application_triggers
  capture_restored_manifest_and_disable_crons
  compare_recovery_state
  rehearse_presentation_schema_against_restored_backup
  write_report
}

main "$@"
