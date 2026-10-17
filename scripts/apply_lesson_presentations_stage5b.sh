#!/usr/bin/env bash
set -euo pipefail

if [[ "${GITHUB_REF:-}" != 'refs/heads/main' ]]; then
  echo 'Production schema deploy requires main.' >&2
  exit 1
fi

if [[ "${GITHUB_EVENT_NAME:-}" == 'workflow_dispatch' &&
      "${PRESENTATIONS_APPROVAL:-}" != 'CONFIRMO_APRESENTACOES_5B' ]]; then
  echo 'Manual execution requires the explicit confirmation phrase.' >&2
  exit 1
fi

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo 'Missing SUPABASE_DB_URL secret. Aborting.' >&2
  exit 1
fi

# psql -1 encompasses both DDL scripts, ledger inserts and postcondition checks.
# An error before COMMIT rolls back all changes.
psql \
  -X \
  --no-password \
  --single-transaction \
  --set=ON_ERROR_STOP=1 \
  --dbname "$SUPABASE_DB_URL" \
  --file scripts/sql/lesson_presentations_stage5b_transactional_rollout.sql

echo 'Production schema transaction finished; release gates remain disabled.'
