#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-${ROOT_DIR}/supabase/migrations}"
readonly MIGRATION_DRIFT_CUTOFF="${MIGRATION_DRIFT_CUTOFF:-20261006000000}"

require_configuration() {
  if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
    echo "::error::SUPABASE_DB_URL is required to compare repository migrations with production."
    exit 1
  fi

  if [[ ! "${MIGRATION_DRIFT_CUTOFF}" =~ ^[0-9]{14}$ ]]; then
    echo "::error::MIGRATION_DRIFT_CUTOFF must contain exactly 14 digits."
    exit 1
  fi

  if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
    echo "::error::Migration directory not found: ${MIGRATIONS_DIR}"
    exit 1
  fi
}

collect_local_versions() {
  find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' -printf '%f\n'     | sed -nE 's/^([0-9]{14})_.+\.sql$/\1/p'     | awk -v cutoff="${MIGRATION_DRIFT_CUTOFF}" '$1 >= cutoff'     | sort -u
}

collect_remote_versions() {
  psql "${SUPABASE_DB_URL}"     -AtX     -v ON_ERROR_STOP=1     -v cutoff="${MIGRATION_DRIFT_CUTOFF}"     -c "select version
        from supabase_migrations.schema_migrations
        where version >= :'cutoff'
        order by version;"
}

main() {
  require_configuration

  local local_versions_file
  local remote_versions_file
  local missing_versions_file

  local_versions_file="$(mktemp)"
  remote_versions_file="$(mktemp)"
  missing_versions_file="$(mktemp)"

  trap 'rm -f "${local_versions_file}" "${remote_versions_file}" "${missing_versions_file}"' EXIT

  collect_local_versions > "${local_versions_file}"
  collect_remote_versions > "${remote_versions_file}"

  comm -23 "${remote_versions_file}" "${local_versions_file}" > "${missing_versions_file}"

  if [[ -s "${missing_versions_file}" ]]; then
    echo "::error::Production contains migration versions that are missing from supabase/migrations:"
    sed 's/^/  - /' "${missing_versions_file}"
    exit 1
  fi

  echo "Supabase migration history is versioned from cutoff ${MIGRATION_DRIFT_CUTOFF} onward."
}

main "$@"
