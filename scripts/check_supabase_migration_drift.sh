#!/usr/bin/env bash
set -euo pipefail

readonly ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly MIGRATIONS_DIR="${MIGRATIONS_DIR:-${ROOT_DIR}/supabase/migrations}"
readonly MIGRATION_GIT_ROOT="${MIGRATION_GIT_ROOT:-${ROOT_DIR}}"
readonly MIGRATION_DRIFT_CUTOFF="${MIGRATION_DRIFT_CUTOFF:-20261006000000}"
readonly MIGRATION_CHECKSUM_CUTOFF="${MIGRATION_CHECKSUM_CUTOFF:-20261007051850}"
readonly MIGRATION_BASE_REF="${MIGRATION_BASE_REF:-}"
readonly MIGRATION_PR_ALLOW_NEW="${MIGRATION_PR_ALLOW_NEW:-false}"

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

  if [[ "${MIGRATION_PR_ALLOW_NEW}" != "true" && "${MIGRATION_PR_ALLOW_NEW}" != "false" ]]; then
    echo "::error::MIGRATION_PR_ALLOW_NEW must be true or false."
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

# Pinned audit identities for a retired and unreleased feature.
retired_migration_records() {
  cat <<'RETIRED_PROJECT_MIGRATIONS'
20261015043416|20261015043416|homeworks_stage2_schema|53de1f08ea80abb52e096616f8e0f32eea7213925d0799bddd2ae9c3e2a3b4af
20261015060000|20261015052321|homeworks_stage4_submission|b4805f5df17c9898411646cc5d5249f98c68903a19a5abd3ff5a09a9d8520f84
20261015065000|20261015063815|homeworks_stage5_teacher_review|745ae55478c5f7978040fe901a67348fe43e66305ef12cbd167e924b201101b5
20261015071000|20261015065527|homeworks_auto_grade_reading_grammar|4d47c634ced700ae8d0e53e8c84e0cdeca83bf6bec079819eec2a68c3b9c2cbb
20261015180000|20261015163925|homeworks_ai_monthly_budget|171df792cb4eff9c4b15fef4d6cd69b103ae30db2acc4bfab25f3a4739547b3c
20261015192900|20261015193625|homeworks_privacy_export|6d8579c6ef03a9e174e0120edbf25ad316b2b3d3027538c99fd8946c1f70c3f0
20261016144000|20261016144444|homeworks_formal_relationship_retention|064b87e35d015b57c0d7651dbb8aaed6b84aa482e994b3e0a0b266f805c08ca7
20261016165000|20261016165814|homeworks_writing_age_verifications|d09a4e2b6f15b4aeb141c2dc5ea34b995ac4c89793b5e7edb0784771c4b75335
20261017110321|20261017110321|retire_unreleased_homeworks_20261017|9f17ac9c4e3b6bcfbe36353a331f221d96ec3a50aa7da0effbc62afa3cb68deb
RETIRED_PROJECT_MIGRATIONS
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

  # Only these exact historical migrations may be removed from Git.
  while IFS='|' read -r git_version remote_version migration_name migration_checksum; do
    local original_name
    original_name="$(awk -F $'\t' -v v="$git_version" '$1 == v { print $2 }' "$base_unique_records_file")"
    if [[ "$original_name" == "$migration_name" ]]; then
      grep -vx "$git_version" "$missing_file" > "$TEMP_DIR/retired_missing" || true
      mv "$TEMP_DIR/retired_missing" "$missing_file"
    fi
  done < <(retired_migration_records)

  # A different, later migration shut down class-seat reservations before the
  # proposed budget migration ever ran. Permit deletion of ONLY the pinned
  # unapplied 20261104024500 blob, and require live ledger absence.
  if grep -qx '20261104024500' "$missing_file"; then
    local discarded_record remote_entry_count
    discarded_record="$(awk -F $'\t' '$1 == "20261104024500" { print $1 "|" $2 "|" $3 }' "$base_unique_records_file")"
    if [[ "$discarded_record" == '20261104024500|throttle_public_class_seat_submission_attempts|7a9529253a7c8359d036ef72b8efc40cabd71097' ]]; then
      remote_entry_count="$(psql "$SUPABASE_DB_URL" -AtX -v ON_ERROR_STOP=1 \
        -c "select count(*) from supabase_migrations.schema_migrations where version='20261104024500'")"
      if [[ "$remote_entry_count" == '0' ]]; then
        grep -vx '20261104024500' "$missing_file" > "$TEMP_DIR/remaining_retired_migrations" || true
        mv "$TEMP_DIR/remaining_retired_migrations" "$missing_file"
        echo "::notice::Pinned unused class-seat rate-limit migration retired; no live ledger row exists."
      else
        echo "::error::Cannot retire an already deployed security migration."
        exit 1
      fi
    fi
  fi

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

# The approved, manually applied 5B SQL is canonical in Git; live ledger
# versions have no statement snapshots. Compare exact digests plus live ACLs.
verify_manual_presentation_catalog() {
  local result
  result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
    --file "${ROOT_DIR}/scripts/sql/lesson_presentations_catalog_attestation.sql")"
  [[ "${result}" == 't' ]]
}
# Catalog-only verification for a manually registered Resend migration.
# This must not rewrite production migration history or replay schema objects.
verify_manual_resend_delivery_catalog() {
  local result
  result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
    --file "${ROOT_DIR}/scripts/sql/resend_delivery_catalog_attestation.sql")"
  [[ "${result}" == 't' ]]
}

# Inspect catalog only; never repair production migration history.
verify_private_schema_hardening_catalog() {
  local result
  result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
    --file "${ROOT_DIR}/scripts/sql/private_schema_security_catalog_attestation.sql")"
  [[ "${result}" == 't' ]]
}

# Verify that the deployed teacher-planned lesson fix matches the canonical
# function body and its original private execution restrictions.
verify_teacher_planned_lesson_catalog() {
  local result
  result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
    --file "${ROOT_DIR}/scripts/sql/teacher_planned_lesson_catalog_attestation.sql")" || return 1
  [[ "${result}" == 't' ]]
}

# This one teacher-v2 migration was committed while the deployment ledger
# still ended before 20:20, but remains unapplied after a separate tuition
# change advanced the production tip. Do not renumber an immutable migration.
# Permit only the exact checked-in Git blob during PR validation and only
# while the protected v2 database functions remain absent in production.
# This attests a *pending* migration, not permission to deploy it.
attest_pending_teacher_v2_migration() {
  local version="$1"
  local name expected_git_blob
  # Exact immutable pending migration identities. No unknown or modified
  # SQL is allowed to predate the production tip during a PR.
  case "$version" in
    20261022202000)
      name=teacher_question_ratings_v2
      expected_git_blob=729ac0534b63caa9762ee930e20f1e414a7ceeb0
      ;;
    20261022212500)
      name=academic_v2_auto_attendance_and_closure
      expected_git_blob=5d851ceec93484b4b6b6c7e2a0ce7272e4150a05
      ;;
    20261022214500)
      name=academic_v2_private_table_rls
      expected_git_blob=64ef3931e4932db147378df796810687a2e58907
      ;;
    20261022220000)
      name=academic_v2_shared_closure_lock
      expected_git_blob=0bb335f70cf3f1d77056320c1f85b19c7aafbfdf
      ;;
    20261022234500)
      name=fix_teacher_v2_closure_day_alias
      expected_git_blob=a01d08074176ea937c3fc8770b21d4562622102e
      ;;
    *) return 1 ;;
  esac

  local file="${MIGRATIONS_DIR}/${version}_${name}.sql"
  [[ -f "$file" ]] || return 1
  [[ "$(git hash-object "$file")" == "$expected_git_blob" ]] || return 1

  # Verification is READ ONLY and fails closed after any partial deployment.
  local missing
  missing="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 -c "
    select (
      to_regprocedure(
        'public.rate_teacher_conversation_question_v2(text,uuid,date,uuid,text)'
      ) is null
      and to_regprocedure(
        'public.get_teacher_question_rating_history_v2(date)'
      ) is null
      and to_regprocedure(
        'private.run_teacher_v2_auto_finalizations()'
      ) is null
      and to_regclass('private.academic_v2_automation_control') is null
      and not exists (
        select 1 from cron.job where jobname='teacher-v2-auto-finalize'
      )
    );
  ")" || return 1

  [[ "$missing" == 't' ]]
}
# These immutable, previously merged migrations have their main catalog objects
# active in production but no corresponding Supabase migration ledger row.
# Require an exact Git blob, exact missing ledger version, and independent
# read-only catalog attestation; never replay finance or holiday SQL here.
attest_unrecorded_active_november_migration() {
  local version="$1"
  local name expected_git_blob
  case "${version}" in
    20261106125500) name=national_holidays_no_lessons_no_replacement; expected_git_blob=39c54580c4a6fc2d8e7e04084f06b452f8354d80 ;;
    20261107143000) name=student_financial_responsibilities; expected_git_blob=a1b865056fd4dd604d9957e0cded36a9b836f55d ;;
    20261107144500) name=financial_responsibility_payment_engine; expected_git_blob=56b67621c17e66cd4f52ae0a0b8ba653f10ce4cc ;;
    20261107151000) name=financial_responsibility_checkout_routing; expected_git_blob=f45895b90121851bc8032bb49dfcb0e64f68aeb4 ;;
    20261107152000) name=financial_responsibility_unique_provider_settlement; expected_git_blob=bfcefd235b00acbaf813146c9c1ed4fe51dd1c84 ;;
    20261107160000) name=financial_responsibility_integrity_audit; expected_git_blob=d5233861fbb3681417772480002e911d7c2e9491 ;;
    20261107162000) name=resume_billing_after_unarchive; expected_git_blob=ce0c4d0e1940ca1453200476a10530deae2c3052 ;;
    20261107162500) name=unarchive_due_date_alignment; expected_git_blob=0608b318b3e2143365c013478b9f8b8083f01562 ;;
    20261107164000) name=financial_refund_full_transaction_amount; expected_git_blob=b40290a1cd2e459732b7d6c81d0867fdd202346e ;;
    20261107165000) name=sponsored_settlement_atomicity_guard; expected_git_blob=b3edec2cc96b3373a16bdff2d716f7960bd4c5b3 ;;
    20261107171500) name=fix_financial_gateway_secret_key_compat; expected_git_blob=1cfffdb71fe0ffd40c76e7aaf8d3e9f6be947264 ;;
    *) return 1 ;;
  esac

  local migration_file="${MIGRATIONS_DIR}/${version}_${name}.sql"
  [[ -f "${migration_file}" ]] || return 1
  [[ "$(git hash-object "${migration_file}")" == "${expected_git_blob}" ]] || return 1

  local deployed_version_count
  deployed_version_count="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
    -c "select count(*) from supabase_migrations.schema_migrations where version='${version}'")" || return 1
  [[ "${deployed_version_count}" == '0' ]] || return 1

  if [[ "${UNRECORDED_NOVEMBER_CATALOG_ATTESTED:-false}" != 'true' ]]; then
    local catalog_result
    catalog_result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
      --file "${ROOT_DIR}/scripts/sql/untracked_202611_feature_catalog_attestation.sql")" || return 1
    [[ "${catalog_result}" == 't' ]] || return 1
    UNRECORDED_NOVEMBER_CATALOG_ATTESTED=true
  fi

  return 0
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

  # Only pinned, hash-verified server-assigned version aliases are recognized.
  # Unexpected versions and modified SQL still fail the immutable history gate.
  local alias_git_version
  local alias_remote_version
  local alias_name
  local alias_sha
  local alias_remote_name
  local alias_remote_sha
  local local_identity
  local remote_identity
  local expected_git
  local expected_remote
  # Different remote names are accepted only when both names and the immutable
  # normalized SQL digest are pinned and match the production ledger exactly.
  while IFS='|' read -r alias_git_version alias_remote_version alias_name alias_sha alias_remote_name alias_remote_sha; do
    [[ -n "$alias_git_version" ]] || continue
    local_identity="$(grep -E "^$alias_git_version[[:space:]]" "$local_records_file" || true)"
    remote_identity="$(grep -E "^$alias_remote_version[[:space:]]" "$remote_records_file" || true)"
    printf -v expected_git '%s\t%s\t%s' "$alias_git_version" "$alias_name" "$alias_sha"
    printf -v expected_remote '%s\t%s\t%s' "$alias_remote_version" "${alias_remote_name:-$alias_name}" "${alias_remote_sha:-$alias_sha}"

    if [[ "$local_identity" == "$expected_git" && "$remote_identity" == "$expected_remote" ]]; then
      # This alias is comment-equivalent but has a different production SQL
      # digest. Require a second, independent proof of the deployed behavior.
      if [[ "$alias_git_version" == '20261111015000' ]]; then
        if ! verify_teacher_planned_lesson_catalog; then
          echo "::error::Teacher-planned lesson catalog or privileges do not match the pinned migration alias."
          exit 1
        fi
      fi

      grep -vx "$alias_git_version" "$local_only_file" > "$TEMP_DIR/alias_remaining_local" || true
      grep -vx "$alias_remote_version" "$remote_only_file" > "$TEMP_DIR/alias_remaining_remote" || true
      mv "$TEMP_DIR/alias_remaining_local" "$local_only_file"
      mv "$TEMP_DIR/alias_remaining_remote" "$remote_only_file"
      echo "::notice::Exact SHA256 and name attest Supabase-generated migration alias; committed SQL and production ledger are unchanged."
    fi
  done <<'VERIFIED_MIGRATION_ALIASES'
20261015030100|20261015030846|add_regular_and_teacher_cancellation_email_notifications|794aede48c9eb4aa382e32882704a38041b71636c7d9892256c6c0fbab539db7
20261015041000|20261015041123|retry_transactional_emails_safely|5550c24828b5de718108b3c0709f50b8079fc1a6f8ea07267a75dc80f8d277da
20261015213000|20261015214937|student_preparation_pilot_eligibility|c026abfefca5a071929eebca566461733ce49ccd590b50b9a485275705ffd264
20261016162500|20261016163745|justify_attended_cancelled_lesson_revocations|f936f2c9d92bd1f9bb92aa0c9cdcd80684562a17fcd7b067f1793ddf10adb3b2
20261020133230|20261020175958|late_payment_policy_quote_foundation|086ead16caddc509b63e610b548d58b38dbe26a4b23d1172437ec6cf6d1eb534
20261020164300|20261020180038|late_payment_settlement_gateway|19ad5781909218ee29e4bd553477cfd80e03b97b9bd452234c9dfaaedbaf6814
20261021013000|20261021014028|deactivate_late_payment_policy|ef460e16063d7237a0160e83b99fc936c0d59aadfa81378c27fb95084b72fb0e||6db4482a6a303867ad3ee7237abacb828c7270e1ad2894077ed77f371aa6c328
20261020180500|20261020192815|guard_lessons_before_class_membership|56817fb3bce31e642645f624200fb8f2ae0583246852d8414927be98bbf13067
20261020224500|20261020224156|first_lesson_after_membership_start|6800e587d50bc1e162fc04f0852ee5b187b9ed315b549364ac54b4742f726874|first_lesson_after_membership_start_20261020
20261021203500|20261021203828|prevent_cross_cycle_lesson_duplicates|cf43cb5e6724a4413c2ec179315b17e79785209caba02ccc21ccd910ffe12985
20261022013500|20261022014200|get_my_studied_questions|e0084dfa4cdd210cb45572f82ea56f2b925b9757a33a01028eee9505c91f9fac|get_my_studied_questions_20261022|e0084dfa4cdd210cb45572f82ea56f2b925b9757a33a01028eee9505c91f9fac
20261022013600|20261022020316|add_standard_100_four_lesson_plan|af0c6ebb61e9a3e7070fc568437bd19ccb588a2ef288eca2b2b91ba7ce84590b|add_standard_100_four_lesson_plan|af0c6ebb61e9a3e7070fc568437bd19ccb588a2ef288eca2b2b91ba7ce84590b
20261022020800|20261022150943|ignore_safely_blocked_admin_accounts_in_auth_health|94d44021c9cd6889336b1226c67e101fb3f83d1e046da20a167e3d9a74116c76
20261022170000|20261022161120|pedagogical_preparation_alerts|74951c1ccd98877b1338c73457eb80a4f447d7077f7edf3537219233d2df01f0
20261022230000|20261022205054|add_tuition_email_reminders|f09b59cbc0b3a5b747776278ddd01e8d3eb90ddbc7ad7d931671e60df6b7660f
20261026123500|20261026123954|realign_future_credits_on_class_transfer|5bb44ae805889a8437be19cb6671d99a238d34289ef2b2ddba837b3296919cef
20261110194000|20261110194300|correct_flexible_credit_audit_balance|716d5d400c84835f953fd34b2b930fa0a0a5f48985e75153f470fa1e441c194e
20261110200900|20261110195444|classify_fixed_historical_replacement_credits|a47764c0736c78fd377ea6fd8c4b5032ef57d6a1fec1b143a0e03201e71489fc
20261111152400|20261111152717|fix_enrollment_notification_implicit_activation|d35ef2347a5450bbd829939e602ecb2de56bb7bc322d9bdb37012e7400096dc6
20261111015000|20261111015223|respect_upcoming_planned_lesson_in_student_preparation|2df3dd9bf54f2d890abec4d758a63556ba48a01642356c1f7546eeacfd54589d|respect_upcoming_teacher_planned_lesson_in_student_preparation|24dd9f59c042585493225ce410e601bce4aa53feeedc676d20ac79deca5b6d9c
VERIFIED_MIGRATION_ALIASES

  # Historical remote rows remain attested by both name and normalized digest.
  while IFS='|' read -r git_version remote_version migration_name migration_checksum; do
    local remote_identity expected_remote
    remote_identity="$(grep -E "^$remote_version[[:space:]]" "$remote_records_file" || true)"
    printf -v expected_remote '%s\t%s\t%s' "$remote_version" "$migration_name" "$migration_checksum"
    if [[ "$remote_identity" == "$expected_remote" ]]; then
      grep -vx "$remote_version" "$remote_only_file" > "$TEMP_DIR/retired_remaining_remote" || true
      mv "$TEMP_DIR/retired_remaining_remote" "$remote_only_file"
    fi
  done < <(retired_migration_records)

  join -t $'\t' \
    -o '1.1,1.2,2.2,1.3,2.3' \
    "${remote_records_file}" \
    "${local_records_file}" > "${joined_file}"

  awk -F $'\t' -v checksum_cutoff="${MIGRATION_CHECKSUM_CUTOFF}" '
    $2 != $3 || ($1 >= checksum_cutoff && $4 != $5) {
      print
    }
  ' "${joined_file}" > "${mismatch_file}"

  # Exception for the exact canonical pair; every other drift remains fatal.
  local empty_sha='e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
  local stage1_line stage3_line expected_stage1 expected_stage3
  stage1_line="$(awk -F $'\t' '$1 == "20261017133000" {print}' "${mismatch_file}")"
  stage3_line="$(awk -F $'\t' '$1 == "20261017144500" {print}' "${mismatch_file}")"
  printf -v expected_stage1 '%s\t%s\t%s\t%s\t%s' \
    '20261017133000' 'lesson_presentations_stage1' \
    'lesson_presentations_stage1' "${empty_sha}" \
    'e7e1f1772e5906a056fb390811cde4b11c3923a8e3c969652c2c1a545fc0430f'
  printf -v expected_stage3 '%s\t%s\t%s\t%s\t%s' \
    '20261017144500' 'lesson_presentation_views_stage3' \
    'lesson_presentation_views_stage3' "${empty_sha}" \
    'd5beaf8f0d3f4b3df92d8f519a80c6895323c4cae20041b90565ac6928898d42'
  if [[ "${stage1_line}" == "${expected_stage1}" &&
        "${stage3_line}" == "${expected_stage3}" ]]; then
    if verify_manual_presentation_catalog; then
      awk -F $'\t' \
        '$1 != "20261017133000" && $1 != "20261017144500"' \
        "${mismatch_file}" > "${TEMP_DIR}/remaining_identity_mismatch"
      mv "${TEMP_DIR}/remaining_identity_mismatch" "${mismatch_file}"
      echo "::notice::Two canonical 5B migrations attested by immutable Git SHA256 and live RLS/ACL catalog. All other drift remains enforced."
    else
      echo "::error::Presentation schema does not match approved 5B catalog attestation."
      exit 1
    fi
  fi
  # The pinned Resend migration is already applied, but its manually
  # registered production ledger entry has no SQL statement snapshot.
  # Accept only its exact immutable Git digest and a passing live catalog audit.
  local resend_line expected_resend
  resend_line="$(awk -F $'\t' '$1 == "20261016213000" {print}' "${mismatch_file}")"
  printf -v expected_resend '%s\t%s\t%s\t%s\t%s' \
    '20261016213000' 'resend_delivery_tracking_and_retention' \
    'resend_delivery_tracking_and_retention' "${empty_sha}" \
    'e7e2b901b2b7d2f7aa9346e622cbe61282205ff943af4d865512465fba2936a7'
  if [[ "${resend_line}" == "${expected_resend}" ]]; then
    if verify_manual_resend_delivery_catalog; then
      awk -F $'\t' '$1 != "20261016213000"' "${mismatch_file}" \
        > "${TEMP_DIR}/remaining_resend_identity_mismatch"
      mv "${TEMP_DIR}/remaining_resend_identity_mismatch" "${mismatch_file}"
      echo "::notice::Pinned Resend SHA256 and read-only production catalog attestation match; all other drift remains enforced."
    else
      echo "::error::Resend live catalog does not match the approved read-only attestation."
      exit 1
    fi
  fi

  # The manual-Pix settlement was applied with an equivalent SQL body.
  # Git differs only in comments and blank lines. Both normalized SHA256
  # identities are pinned; any other discrepancy remains a hard failure.
  local manual_pix_line expected_manual_pix
  manual_pix_line="$(awk -F $'\t' '$1 == "20261029144657" {print}' "${mismatch_file}")"
  printf -v expected_manual_pix '%s\t%s\t%s\t%s\t%s' \
    '20261029144657' 'record_manual_pix_refund_settlement' \
    'record_manual_pix_refund_settlement' \
    '70df76659e1d4180a78030a2ff58c49305de2cf5eae6cff6872dfda0453da6ad' \
    '9ba9f11f9123d34f2a4406bba75fe56cafc76d4493806ed43c7498581b856a12'
  if [[ "${manual_pix_line}" == "${expected_manual_pix}" ]]; then
    awk -F $'\t' '$1 != "20261029144657"' "${mismatch_file}" \
      > "${TEMP_DIR}/remaining_manual_pix_identity_mismatch"
    mv "${TEMP_DIR}/remaining_manual_pix_identity_mismatch" "${mismatch_file}"
    echo "::notice::Manual Pix migration has two exact, comment-only SHA256 identities. All other drift remains enforced."
  fi

  # The original FLEXIVEL manual-credit migration was already applied with
  # equivalent SQL and different comments. Keep both immutable histories:
  # require exact Git and ledger digests plus the live function/ACL digest.
  local manual_flexible_line expected_manual_flexible_line
  manual_flexible_line="$(awk -F $'\t' '$1 == "20261110173354" {print}' "${mismatch_file}")"
  printf -v expected_manual_flexible_line '%s\t%s\t%s\t%s\t%s' \
    '20261110173354' 'allow_manual_flexible_credits' \
    'allow_manual_flexible_credits' \
    'ad39e802f6aedc716616da25ee85aa8a39ad7c8fe84bf3f883dc3ecdba4712c7' \
    'b1fc15d10909ec46aa7429a186db7cef2534feee7aea3b8462871f36610b9e5f'
  if [[ "${manual_flexible_line}" == "${expected_manual_flexible_line}" ]]; then
    local manual_flexible_catalog_valid
    manual_flexible_catalog_valid="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 -c "
      select coalesce(
        encode(
          extensions.digest(
            pg_get_functiondef('private.flexible_credit_for_date(uuid,date)'::regprocedure),
            'sha256'
          ),
          'hex'
        ) = 'b255b4675bcd44d1a3663c5b1eb836179827d9f067d238fc674dfab765fe1bf7'
        and not has_function_privilege(
          'anon', 'private.flexible_credit_for_date(uuid,date)', 'EXECUTE'
        )
        and not has_function_privilege(
          'authenticated', 'private.flexible_credit_for_date(uuid,date)', 'EXECUTE'
        ),
        false
      );")" || exit 1

    if [[ "${manual_flexible_catalog_valid}" == 't' ]]; then
      awk -F $'\t' '$1 != "20261110173354"' "${mismatch_file}" \
        > "${TEMP_DIR}/remaining_manual_flexible_identity_mismatch"
      mv "${TEMP_DIR}/remaining_manual_flexible_identity_mismatch" "${mismatch_file}"
      echo "::notice::Pinned manual FLEXIVEL credit migration and live function/ACL verified; all other drift remains enforced."
    else
      echo "::error::Manual FLEXIVEL credit migration catalog attestation failed."
      exit 1
    fi
  fi

  # The immutable Git migration contains two comments absent from the
  # applied SQL. This precise identity is accepted only while live RLS and
  # private EXECUTE privileges pass the independent read-only attestation.
  local private_rls_line expected_private_rls_line
  private_rls_line="$(awk -F $'\t' '$1 == "20261104013111" {print}' "${mismatch_file}")"
  printf -v expected_private_rls_line '%s\t%s\t%s\t%s\t%s' \
    '20261104013111' 'secure_private_billing_plan_rls' \
    'secure_private_billing_plan_rls' \
    '679cbd483d1bd1b0a80062bf21b4dbac9f2eed63ac6e2187db46ccf894f7ade9' \
    'ab71e00aac45b4fec4a6c1276b220c17c7c220e7fc8b8295f1b3362f89aab92f'
  if [[ "${private_rls_line}" == "${expected_private_rls_line}" ]]; then
    if verify_private_schema_hardening_catalog; then
      awk -F $'\t' '$1 != "20261104013111"' "${mismatch_file}" \
        > "${TEMP_DIR}/remaining_private_rls_identity_mismatch"
      mv "${TEMP_DIR}/remaining_private_rls_identity_mismatch" "${mismatch_file}"
      echo "::notice::Private RLS migration pinned by SHA256 and live catalog; all other drift remains enforced."
    else
      echo "::error::Private RLS catalog attestation failed."
      exit 1
    fi
  fi

  # Only this exact pre-existing difference is approved: immutable Git SQL
  # and the applied SQL implement the same origin guard, with a live audit.
  local origin_line origin_catalog_result
  origin_line="$(grep -E '^20261109155035[[:space:]]' "${mismatch_file}" || true)"
  if [[ "${origin_line}" == '20261109155035	add_anuncio80_acquisition_origin	add_anuncio80_acquisition_origin	aee245574b1fe633f02f82de53369ca4c7fcfd86f0c2eeb25453f4c68351d593	328c4b9f8a316632128b5017eaf14ef7a05caa3ca9dafede9f0276e5e841779e' ]]; then
    origin_catalog_result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
      --file "${ROOT_DIR}/scripts/sql/anuncio80_origin_catalog_attestation.sql")" || exit 1
    if [[ "${origin_catalog_result}" == 't' ]]; then
      grep -v '^20261109155035[[:space:]]' "${mismatch_file}" > "${TEMP_DIR}/origin_remainder" || true
      mv "${TEMP_DIR}/origin_remainder" "${mismatch_file}"
      echo "::notice::Pinned anúncio80 origin SQL variant verified against the live catalog."
    else
      echo "::error::Anúncio80 origin catalog attestation failed."
      exit 1
    fi
  fi
  # The original Git migration differs only in comments from the applied
  # SQL. Keep both histories immutable and attest the exact digests and catalog.
  local first_tuition_line expected_first_tuition_line
  first_tuition_line="$(awk -F $'\t' '$1 == "20261110142911" {print}' "${mismatch_file}")"
  printf -v expected_first_tuition_line '%s\t%s\t%s\t%s\t%s' \
    '20261110142911' 'fix_first_tuition_trigger_on_google_enrollment' \
    'fix_first_tuition_trigger_on_google_enrollment' \
    '1db76ec704da5295963dc4bb4bb71e77926da336732735d213968a69b58880e1' \
    '6c4ca9bad7fd5a17ad6b8ac2d97795604b9656e4d4d6b0ccec03e7316df5f6b7'
  if [[ "${first_tuition_line}" == "${expected_first_tuition_line}" ]]; then
    local first_tuition_catalog_result
    first_tuition_catalog_result="$(psql "${SUPABASE_DB_URL}" -AtX -v ON_ERROR_STOP=1 \
      --file "${ROOT_DIR}/scripts/sql/first_tuition_trigger_catalog_attestation.sql")" || exit 1
    if [[ "${first_tuition_catalog_result}" == 't' ]]; then
      grep -v '^20261110142911[[:space:]]' "${mismatch_file}" \
        > "${TEMP_DIR}/first_tuition_identity_remainder" || true
      mv "${TEMP_DIR}/first_tuition_identity_remainder" "${mismatch_file}"
      echo "::notice::Pinned first-tuition migration and live trigger catalog verified."
    else
      echo "::error::First-tuition live trigger does not match the approved catalog."
      exit 1
    fi
  fi

  if [[ -s "${remote_only_file}" ]]; then
    echo "::error::Production contains migration versions that are missing from supabase/migrations:"
    sed 's/^/  - /' "${remote_only_file}"
    drift_found=true
  fi

  if [[ -s "${local_only_file}" ]]; then
    if [[ "${MIGRATION_PR_ALLOW_NEW}" == "true" ]]; then
      # PRs may propose append-only migrations; they must not already be in
      # production. Published versions remain strictly protected above.
      local production_tip
      production_tip="$(tail -n 1 "${remote_versions_file}")"
      if [[ ! "${production_tip}" =~ ^[0-9]{14}$ ]]; then
        echo "::error::Production migration history is empty or malformed."
        drift_found=true
      fi
      while IFS= read -r new_version; do
        if [[ ! "${production_tip}" =~ ^[0-9]{14}$ ]]; then
          echo "::error::Production migration tip is malformed."
          drift_found=true
        elif [[ "${new_version}" > "${production_tip}" ]]; then
          echo "::notice::Proposed, unapplied PR migration ${new_version}; verify in isolated preview before merge."
        elif attest_pending_teacher_v2_migration "${new_version}"; then
          echo "::notice::Immutable teacher-v2 migration ${new_version} is attested pending and absent from production; isolated replay is required before activation."
        elif attest_unrecorded_active_november_migration "${new_version}"; then
          echo "::notice::Immutable November migration ${new_version}: catalog and Git identity verified; ledger remains unchanged."
        else
          echo "::error::New migration ${new_version} must be newer than the current production tip ${production_tip}, unless an exact immutable pending version is independently attested."
          drift_found=true
        fi
      done < "${local_only_file}"
    else
      echo "::error::supabase/migrations contains versions that are missing from production migration history:"
      sed 's/^/  - /' "${local_only_file}"
      drift_found=true
    fi
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

  echo "Supabase migration IDs are globally unique and committed history is immutable. Existing production identities match the repository; PR-only new versions, when allowed, require isolated testing."
}

main "$@"
