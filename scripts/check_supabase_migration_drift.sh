#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-${ROOT_DIR}/supabase/migrations}"
readonly MIGRATION_GIT_ROOT="${MIGRATION_GIT_ROOT:-${ROOT_DIR}}"
readonly MIGRATION_DRIFT_CUTOFF="${MIGRATION_DRIFT_CUTOFF:-20261006000000}"
readonly MIGRATION_CHECKSUM_CUTOFF="${MIGRATION_CHECKSUM_CUTOFF:-20261007051850}"
readonly MIGRATION_BASE_REF="${MIGRATION_BASE_REF:-}"

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

  if [[ ! "${MIGRATION_CHECKSUM_CUTOFF}" =~ ^[0-9]{14}$ ]]; then
    echo "::error::MIGRATION_CHECKSUM_CUTOFF must contain exactly 14 digits."
    exit 1
  fi

  if [[ "${MIGRATION_CHECKSUM_CUTOFF}" < "${MIGRATION_DRIFT_CUTOFF}" ]]; then
    echo "::error::MIGRATION_CHECKSUM_CUTOFF cannot be earlier than MIGRATION_DRIFT_CUTOFF."
    exit 1
  fi

  if [[ ! -d "${MIGRATIONS_DIR}" ]]; then
    echo "::error::Migration directory not found: ${MIGRATIONS_DIR}"
    exit 1
  fi
}

normalized_sha256() {
  local file="$1"

  perl -0pe 's/\A\s+//; s/\s+\z//' "${file}" \
    | sha256sum \
    | awk '{print $1}'
}

parse_migration_filename() {
  local filename="$1"

  if [[ ! "${filename}" =~ ^([0-9]{14})_(.+)\.sql$ ]]; then
    echo "::error::Invalid migration filename: ${filename}. Expected <14-digit-version>_<name>.sql." >&2
    return 1
  fi

  printf '%s\t%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
}

collect_local_records() {
  local file
  local filename
  local parsed
  local version
  local name
  local git_blob_checksum
  local content_checksum

  while IFS= read -r file; do
    filename="${file##*/}"
    parsed="$(parse_migration_filename "${filename}")"
    version="${parsed%%$'\t'*}"
    name="${parsed#*$'\t'}"
    git_blob_checksum="$(git hash-object "${file}")"
    content_checksum="$(normalized_sha256 "${file}")"

    printf '%s\t%s\t%s\t%s\t%s\n' \
      "${version}" \
      "${name}" \
      "${git_blob_checksum}" \
      "${content_checksum}" \
      "${filename}"
  done < <(
    find "${MIGRATIONS_DIR}" -maxdepth 1 -type f -name '*.sql' -print \
      | LC_ALL=C sort
  )
}

validate_unique_local_versions() {
  local records_file="$1"
  local duplicates_file="${TEMP_DIR}/duplicate_local_versions"

  cut -f1 "${records_file}" \
    | LC_ALL=C sort \
    | uniq -d > "${duplicates_file}"

  if [[ ! -s "${duplicates_file}" ]]; then
    return 0
  fi

  echo "::error::Duplicate Supabase migration versions are not allowed anywhere in supabase/migrations."

  while IFS= read -r version; do
    echo "Version ${version}:"
    awk -F $'\t' -v version="${version}" '
      $1 == version {
        printf "  - %s (git-blob=%s, sha256=%s)\n", $5, $3, $4
      }
    ' "${records_file}"
  done < "${duplicates_file}"

  exit 1
}

collect_git_reference_records() {
  local reference="$1"
  local path
  local filename
  local parsed
  local version
  local name
  local git_blob_checksum

  while IFS= read -r path; do
    [[ "${path}" == *.sql ]] || continue

    filename="${path##*/}"
    parsed="$(parse_migration_filename "${filename}")"
    version="${parsed%%$'\t'*}"
    name="${parsed#*$'\t'}"
    git_blob_checksum="$(git -C "${MIGRATION_GIT_ROOT}" rev-parse "${reference}:${path}")"

    printf '%s\t%s\t%s\t%s\n' \
      "${version}" \
      "${name}" \
      "${git_blob_checksum}" \
      "${filename}"
  done < <(
    git -C "${MIGRATION_GIT_ROOT}" \
      ls-tree -r --name-only "${reference}" -- supabase/migrations \
      | LC_ALL=C sort
  )
}

validate_historical_immutability() {
  local local_records_file="$1"

  if [[ -z "${MIGRATION_BASE_REF}" ]]; then
    return 0
  fi

  if ! git -C "${MIGRATION_GIT_ROOT}" cat-file -e "${MIGRATION_BASE_REF}^{commit}" 2>/dev/null; then
    echo "::error::MIGRATION_BASE_REF does not resolve to a commit: ${MIGRATION_BASE_REF}"
    exit 1
  fi

  local base_records_file="${TEMP_DIR}/base_records"
  local base_duplicate_versions_file="${TEMP_DIR}/base_duplicate_versions"
  local base_unique_records_file="${TEMP_DIR}/base_unique_records"
  local current_identity_file="${TEMP_DIR}/current_identity"
  local comparison_file="${TEMP_DIR}/historical_comparison"
  local missing_file="${TEMP_DIR}/historical_missing"
  local mismatch_file="${TEMP_DIR}/historical_mismatch"

  collect_git_reference_records "${MIGRATION_BASE_REF}" > "${base_records_file}"

  cut -f1 "${base_records_file}" \
    | LC_ALL=C sort \
    | uniq -d > "${base_duplicate_versions_file}"

  awk -F $'\t' '
    FILENAME == ARGV[1] {
      duplicate[$1] = 1
      next
    }
    !($1 in duplicate) {
      print $1 "\t" $2 "\t" $3
    }
  ' "${base_duplicate_versions_file}" "${base_records_file}" \
    | LC_ALL=C sort -t $'\t' -k1,1 > "${base_unique_records_file}"

  awk -F $'\t' 'BEGIN { OFS = FS } { print $1, $2, $3 }' "${local_records_file}" \
    | LC_ALL=C sort -t $'\t' -k1,1 > "${current_identity_file}"

  comm -23 \
    <(cut -f1 "${base_unique_records_file}") \
    <(cut -f1 "${current_identity_file}") > "${missing_file}"

  join -t $'\t' \
    -o '1.1,1.2,2.2,1.3,2.3' \
    "${base_unique_records_file}" \
    "${current_identity_file}" > "${comparison_file}"

  awk -F $'\t' '
    $2 != $3 || $4 != $5 {
      print
    }
  ' "${comparison_file}" > "${mismatch_file}"

  if [[ ! -s "${missing_file}" && ! -s "${mismatch_file}" ]]; then
    return 0
  fi

  if [[ -s "${missing_file}" ]]; then
    echo "::error::Previously committed migration versions were removed or renumbered:"
    sed 's/^/  - /' "${missing_file}"
  fi

  if [[ -s "${mismatch_file}" ]]; then
    echo "::error::Previously committed migrations are immutable; name or checksum changed:"
    while IFS=$'\t' read -r version base_name current_name base_checksum current_checksum; do
      echo "  - ${version}"
      if [[ "${base_name}" != "${current_name}" ]]; then
        echo "    base name:    ${base_name}"
        echo "    current name: ${current_name}"
      fi
      if [[ "${base_checksum}" != "${current_checksum}" ]]; then
        echo "    base checksum:    ${base_checksum}"
        echo "    current checksum: ${current_checksum}"
      fi
    done < "${mismatch_file}"
  fi

  exit 1
}

collect_remote_records() {
  psql "${SUPABASE_DB_URL}" \
    -AtX \
    -F $'\t' \
    -v ON_ERROR_STOP=1 \
    -c "select
          version,
          coalesce(name, ''),
          encode(
            extensions.digest(
              convert_to(
                regexp_replace(
                  regexp_replace(
                    coalesce(array_to_string(statements, E'\\n'), ''),
                    '^[[:space:]]+',
                    ''
                  ),
                  '[[:space:]]+$',
                  ''
                ),
                'UTF8'
              ),
              'sha256'
            ),
            'hex'
          )
        from supabase_migrations.schema_migrations
        where version >= '${MIGRATION_DRIFT_CUTOFF}'
        order by version;"
}

filter_local_records_from_cutoff() {
  local records_file="$1"

  awk -F $'\t' -v cutoff="${MIGRATION_DRIFT_CUTOFF}" '
    BEGIN { OFS = FS }
    $1 >= cutoff {
      print $1, $2, $4
    }
  ' "${records_file}" \
    | LC_ALL=C sort -t $'\t' -k1,1
}

compare_production_identity() {
  local local_records_file="$1"
  local remote_records_file="$2"
  local remote_versions_file="${TEMP_DIR}/remote_versions"
  local local_versions_file="${TEMP_DIR}/local_versions"
  local remote_only_file="${TEMP_DIR}/remote_only"
  local local_only_file="${TEMP_DIR}/local_only"
  local joined_file="${TEMP_DIR}/joined"
  local mismatch_file="${TEMP_DIR}/identity_mismatch"
  local drift_found=false

  cut -f1 "${remote_records_file}" > "${remote_versions_file}"
  cut -f1 "${local_records_file}" > "${local_versions_file}"

  comm -23 "${remote_versions_file}" "${local_versions_file}" > "${remote_only_file}"
  comm -13 "${remote_versions_file}" "${local_versions_file}" > "${local_only_file}"

  join -t $'\t' \
    -o '1.1,1.2,2.2,1.3,2.3' \
    "${remote_records_file}" \
    "${local_records_file}" > "${joined_file}"

  awk -F 

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

  if [[ -s "${mismatch_file}" ]]; then
    echo "::error::Migration identity differs between production and Git:"
    while IFS=$'\t' read -r version remote_name local_name remote_checksum local_checksum; do
      echo "  - ${version}"
      if [[ "${remote_name}" != "${local_name}" ]]; then
        echo "    production name: ${remote_name}"
        echo "    Git name:        ${local_name}"
      fi
      if [[ ( "${version}" == "${MIGRATION_CHECKSUM_CUTOFF}" || "${version}" > "${MIGRATION_CHECKSUM_CUTOFF}" ) && "${remote_checksum}" != "${local_checksum}" ]]; then
        echo "    production sha256: ${remote_checksum}"
        echo "    Git sha256:        ${local_checksum}"
      fi
    done < "${mismatch_file}"
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

  local local_records_file="${TEMP_DIR}/local_records"
  local local_cutoff_records_file="${TEMP_DIR}/local_cutoff_records"
  local remote_records_file="${TEMP_DIR}/remote_records"

  collect_local_records > "${local_records_file}"
  validate_unique_local_versions "${local_records_file}"
  validate_historical_immutability "${local_records_file}"

  filter_local_records_from_cutoff "${local_records_file}" > "${local_cutoff_records_file}"
  collect_remote_records > "${remote_records_file}"

  compare_production_identity "${local_cutoff_records_file}" "${remote_records_file}"

  echo "Supabase migration IDs are globally unique and committed history is immutable. Production version/name matches Git from ${MIGRATION_DRIFT_CUTOFF}; checksum identity matches from ${MIGRATION_CHECKSUM_CUTOFF}."
}

main "$@"
\t' -v checksum_cutoff="${MIGRATION_CHECKSUM_CUTOFF}" '
    $2 != $3 || ($1 >= checksum_cutoff && $4 != $5) {
      print
    }
  ' "${joined_file}" > "${mismatch_file}"

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

  if [[ -s "${mismatch_file}" ]]; then
    echo "::error::Migration identity differs between production and Git:"
    while IFS=$'\t' read -r version remote_name local_name remote_checksum local_checksum; do
      echo "  - ${version}"
      if [[ "${remote_name}" != "${local_name}" ]]; then
        echo "    production name: ${remote_name}"
        echo "    Git name:        ${local_name}"
      fi
      if [[ "${remote_checksum}" != "${local_checksum}" ]]; then
        echo "    production sha256: ${remote_checksum}"
        echo "    Git sha256:        ${local_checksum}"
      fi
    done < "${mismatch_file}"
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

  local local_records_file="${TEMP_DIR}/local_records"
  local local_cutoff_records_file="${TEMP_DIR}/local_cutoff_records"
  local remote_records_file="${TEMP_DIR}/remote_records"

  collect_local_records > "${local_records_file}"
  validate_unique_local_versions "${local_records_file}"
  validate_historical_immutability "${local_records_file}"

  filter_local_records_from_cutoff "${local_records_file}" > "${local_cutoff_records_file}"
  collect_remote_records > "${remote_records_file}"

  compare_production_identity "${local_cutoff_records_file}" "${remote_records_file}"

  echo "Supabase migration IDs are globally unique, committed history is immutable, and production identity matches Git from cutoff ${MIGRATION_DRIFT_CUTOFF} onward."
}

main "$@"
