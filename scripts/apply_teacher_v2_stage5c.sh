#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo 'Teacher v2 schema rollout requires main.' >&2
  exit 1
fi
if [[ "${GITHUB_EVENT_NAME:-}" != "workflow_dispatch" ||
      "${TEACHER_V2_APPROVAL:-}" != "CONFIRMO_ROTEIRO_V2_5C" ]]; then
  echo 'Manual, explicit teacher-v2 schema approval is required.' >&2
  exit 1
fi
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo 'Missing production database connection secret.' >&2
  exit 1
fi

# Pin five immutable Git blobs before passing the canonical SQL contents
# through psql variables. The stored statements[] digests will match Git.
migration_files=(
  supabase/migrations/20261022202000_teacher_question_ratings_v2.sql
  supabase/migrations/20261022212500_academic_v2_auto_attendance_and_closure.sql
  supabase/migrations/20261022214500_academic_v2_private_table_rls.sql
  supabase/migrations/20261022220000_academic_v2_shared_closure_lock.sql
  supabase/migrations/20261022234500_fix_teacher_v2_closure_day_alias.sql
)
migration_blobs=(
  729ac0534b63caa9762ee930e20f1e414a7ceeb0
  5d851ceec93484b4b6b6c7e2a0ce7272e4150a05
  64ef3931e4932db147378df796810687a2e58907
  0bb335f70cf3f1d77056320c1f85b19c7aafbfdf
  a01d08074176ea937c3fc8770b21d4562622102e
)
sql_arguments=()
for i in "${!migration_files[@]}"; do
  file="${migration_files[i]}"
  if [[ "$(git hash-object "${file}")" != "${migration_blobs[i]}" ]]; then
    echo 'Migration file changed from the approved immutable Git blob.' >&2
    exit 1
  fi
  sql_arguments+=(--set="v2_sql_$((i+1))=$(cat "${file}")")
done

# All DDL, canonical SQL ledger rows, and postflight happen atomically.
# Contents are passed as SQL-quoted psql variables, never interpolated raw.
psql -X --no-password --single-transaction \
  --set=ON_ERROR_STOP=1 \
  "${sql_arguments[@]}" \
  --dbname "${SUPABASE_DB_URL}" \
  --file scripts/sql/teacher_v2_stage5c_selective_rollout.sql

echo 'Teacher v2 schema installed; client writes and server automation remain OFF.'
