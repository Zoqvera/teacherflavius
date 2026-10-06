#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-${ROOT_DIR}/supabase/migrations}"
readonly MIGRATION_DRIFT_CUTOFF="${MIGRATION_DRIFT_CUTOFF:-20261006000000}"

TEMP_DIR=""

cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf -- "${TEMP_DIR}"
  fi
}

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
  find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' -printf '%f\n' \
    | sed -nE 's/^([0-9]{14})_.+\.sql$/\1/p' \
    | awk -v cutoff="${MIGRATION_DRIFT_CUTOFF}" '$1 >= cutoff' \
    | sort -u
}

collect_remote_versions() {
  psql "${SUPABASE_DB_URL}" \
    -AtX \
    -v ON_ERROR_STOP=1 \
    -c "select version
        from supabase_migrations.schema_migrations
        where version >= '${MIGRATION_DRIFT_CUTOFF}'
        order by version;"
}

report_drift() {
  local remote_only_file="$1"
  local local_only_file="$2"
  local drift_found=false

  if [[ -s "${remote_only_file}" ]]; then
    echo "::error::Production contains migration versions that are missing from supabase/migrations:"
    sed 's/^/  - /' "${remote_only_file}"
    drift_found=true
  fi

  if [[ -s "${local_only_file}" ]]; then
    echo "::error::supabase/migrations contains versions that are missing from production migration history:"
    sed 's/^/  - /' "${local_only_file}"
    drift_found=true
  fi

  if [[ "${drift_found}" == true ]]; then
    exit 1
  fi
}

main() {
  require_configuration

  TEMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local local_versions_file="${TEMP_DIR}/local_versions"
  local remote_versions_file="${TEMP_DIR}/remote_versions"
  local remote_only_file="${TEMP_DIR}/remote_only"
  local local_only_file="${TEMP_DIR}/local_only"

  collect_local_versions > "${local_versions_file}"
  collect_remote_versions > "${remote_versions_file}"

  comm -23 "${remote_versions_file}" "${local_versions_file}" > "${remote_only_file}"
  comm -13 "${remote_versions_file}" "${local_versions_file}" > "${local_only_file}"

  report_drift "${remote_only_file}" "${local_only_file}"

  echo "Supabase migration history and Git are aligned from cutoff ${MIGRATION_DRIFT_CUTOFF} onward."
}

main "$@"
