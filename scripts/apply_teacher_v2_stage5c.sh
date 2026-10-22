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

# All DDL, every canonical ledger row, and the postflight happen atomically.
# No historical migration is renumbered, no existing student data is touched.
psql -X --no-password --single-transaction \
  --set=ON_ERROR_STOP=1 \
  --dbname "${SUPABASE_DB_URL}" \
  --file scripts/sql/teacher_v2_stage5c_selective_rollout.sql

echo 'Teacher v2 schema installed; client writes and server automation remain OFF.'
