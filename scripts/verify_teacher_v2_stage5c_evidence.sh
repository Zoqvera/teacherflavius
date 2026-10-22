#!/usr/bin/env bash
set -euo pipefail

# Reuse the repository's attested encrypted-backup and independent
# recovery evidence. This fails unless a backup/recovery is current.
bash scripts/verify_lesson_presentations_stage5b_evidence.sh

if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ||
      -z "${GITHUB_SHA:-}" ]]; then
  echo 'Missing connected GitHub attestation context.' >&2
  exit 1
fi

# Require a deliberate, successful baseline restore rehearsal on precisely
# the main revision being released. An unrelated passing PR is not enough.
runs="$(gh api "repos/${GITHUB_REPOSITORY}/actions/workflows/validate-supabase-baseline.yml/runs?per_page=60")"

if ! jq -e --arg sha "${GITHUB_SHA}" '
  any(.workflow_runs[];
    .name == "Validate Supabase baseline restore"
    and .event == "workflow_dispatch"
    and .head_branch == "main"
    and .head_sha == $sha
    and .status == "completed"
    and .conclusion == "success"
    and (now - (.updated_at | fromdateiso8601)) < 86400
  )
' <<< "$runs" >/dev/null; then
  echo 'No successful manual disposable v2 restore rehearsal for this main commit in the past 24 hours.' >&2
  exit 1
fi

echo 'Fresh encrypted backup, recovery and same-revision disposable rehearsal verified.'
