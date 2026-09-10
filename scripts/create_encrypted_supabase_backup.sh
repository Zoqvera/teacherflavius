#!/usr/bin/env bash
set -euo pipefail

require_environment() {
  if [ -z "${SUPABASE_DB_URL:-}" ]; then
    echo '::error::Missing repository secret SUPABASE_DB_URL.'
    exit 1
  fi

  if [ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]; then
    echo '::error::Missing repository secret BACKUP_ENCRYPTION_PASSPHRASE.'
    exit 1
  fi

  if [ "${#BACKUP_ENCRYPTION_PASSPHRASE}" -lt 32 ]; then
    echo '::error::BACKUP_ENCRYPTION_PASSPHRASE must contain at least 32 characters.'
    exit 1
  fi

  if [ -z "${RUNNER_TEMP:-}" ] || [ -z "${GITHUB_OUTPUT:-}" ]; then
    echo '::error::This script must run inside GitHub Actions.'
    exit 1
  fi
}

prepare_paths() {
  BACKUP_ID="$(date -u +'%Y%m%dT%H%M%SZ')"
  BACKUP_DIR="$RUNNER_TEMP/teacherflavius-$BACKUP_ID"
  ARCHIVE="$RUNNER_TEMP/teacherflavius-$BACKUP_ID.tar.gz"
  ENCRYPTED="$ARCHIVE.gpg"
  CHECKSUM="$ENCRYPTED.sha256"
  VERIFY_ARCHIVE="$RUNNER_TEMP/verify-$BACKUP_ID.tar.gz"
  VERIFY_DIR="$RUNNER_TEMP/verify-$BACKUP_ID"
  mkdir -p "$BACKUP_DIR"
}

cleanup_plaintext() {
  rm -rf -- "${BACKUP_DIR:-}" "${ARCHIVE:-}" "${VERIFY_ARCHIVE:-}" "${VERIFY_DIR:-}"
}

write_outputs() {
  local day_of_month tier retention
  day_of_month="$(date -u +'%d')"
  if [ "$day_of_month" = '01' ]; then
    tier='monthly'
    retention='90'
  else
    tier='daily'
    retention='30'
  fi

  {
    echo "backup_id=$BACKUP_ID"
    echo "tier=$tier"
    echo "retention=$retention"
    echo "encrypted=$ENCRYPTED"
    echo "checksum=$CHECKSUM"
  } >> "$GITHUB_OUTPUT"
}

create_dump_set() {
  supabase db dump --db-url "$SUPABASE_DB_URL" --file "$BACKUP_DIR/roles.sql" --role-only
  supabase db dump --db-url "$SUPABASE_DB_URL" --file "$BACKUP_DIR/schema.sql"
  supabase db dump \
    --db-url "$SUPABASE_DB_URL" \
    --file "$BACKUP_DIR/data.sql" \
    --use-copy \
    --data-only \
    --exclude 'storage.buckets_vectors' \
    --exclude 'storage.vector_indexes'
  supabase db dump \
    --db-url "$SUPABASE_DB_URL" \
    --file "$BACKUP_DIR/history_schema.sql" \
    --schema supabase_migrations
  supabase db dump \
    --db-url "$SUPABASE_DB_URL" \
    --file "$BACKUP_DIR/history_data.sql" \
    --use-copy \
    --data-only \
    --schema supabase_migrations
}

capture_recovery_manifest() {
  psql "$SUPABASE_DB_URL" \
    -At \
    --variable ON_ERROR_STOP=1 \
    --file supabase/recovery/recovery_manifest.sql \
    > "$BACKUP_DIR/recovery_manifest.json"

  jq -e '
    .format_version == 2
    and (.critical_row_counts | type == "object")
    and (.catalog_fingerprint | type == "object")
    and (.storage | type == "object")
    and (.cron_jobs | length == 8)
  ' "$BACKUP_DIR/recovery_manifest.json" >/dev/null
}

validate_dump_set() {
  local file
  for file in roles.sql schema.sql data.sql history_schema.sql history_data.sql recovery_manifest.json; do
    if [ ! -s "$BACKUP_DIR/$file" ]; then
      echo "::error::Backup file is missing or empty: $file"
      exit 1
    fi
  done

  (
    cd "$BACKUP_DIR"
    sha256sum \
      roles.sql \
      schema.sql \
      data.sql \
      history_schema.sql \
      history_data.sql \
      recovery_manifest.json \
      > manifest.sha256
  )

  cat > "$BACKUP_DIR/README.txt" <<'EOF'
Teacherflavius encrypted Supabase logical backup.
This archive contains production database data and must remain confidential.
recovery_manifest.json contains only technical counts/configuration used by the automated restore verifier.
Restore instructions are versioned in BACKUP_RECOVERY.md in the repository.
EOF
}

encrypt_backup() {
  tar -C "$BACKUP_DIR" -czf "$ARCHIVE" .

  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | \
    gpg \
      --batch \
      --yes \
      --pinentry-mode loopback \
      --passphrase-fd 0 \
      --symmetric \
      --cipher-algo AES256 \
      --s2k-digest-algo SHA512 \
      --output "$ENCRYPTED" \
      "$ARCHIVE"

  (
    cd "$(dirname "$ENCRYPTED")"
    sha256sum "$(basename "$ENCRYPTED")" > "$(basename "$CHECKSUM")"
  )
}

verify_encrypted_backup() {
  mkdir -p "$VERIFY_DIR"

  printf '%s' "$BACKUP_ENCRYPTION_PASSPHRASE" | \
    gpg \
      --batch \
      --yes \
      --pinentry-mode loopback \
      --passphrase-fd 0 \
      --decrypt \
      --output "$VERIFY_ARCHIVE" \
      "$ENCRYPTED"

  tar -xzf "$VERIFY_ARCHIVE" -C "$VERIFY_DIR"
  (
    cd "$VERIFY_DIR"
    sha256sum --check manifest.sha256
  )
}

main() {
  require_environment
  prepare_paths
  trap cleanup_plaintext EXIT
  create_dump_set
  capture_recovery_manifest
  validate_dump_set
  encrypt_backup
  verify_encrypted_backup
  write_outputs
}

main "$@"
