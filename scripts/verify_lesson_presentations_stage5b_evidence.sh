#!/usr/bin/env bash
# Evidence comes exclusively from successful, connected GitHub Actions runs.
set -euo pipefail

readonly REPORT_DIR="${RUNNER_TEMP:?}/lesson-presentation-recovery"

if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo 'Missing GitHub Actions read-only credentials.' >&2
  exit 1
fi

# Query the recovery workflow directly; this repository runs many CI jobs per hour.
recovery_runs="$(gh api "repos/$GITHUB_REPOSITORY/actions/workflows/supabase-backup-recovery-test.yml/runs?per_page=30")"
recovery_run_id="$(jq -r '
  [.workflow_runs[]
    | select(
        .name == "Verify Supabase backup recovery"
        and .event == "workflow_run"
        and .head_branch == "main"
        and .status == "completed"
        and .conclusion == "success"
      )
  ] | first | .id // empty
' <<< "$recovery_runs")"
if [[ ! "$recovery_run_id" =~ ^[0-9]+$ ]]; then
  echo 'No successful automatic production backup recovery run was found.' >&2
  exit 1
fi

recovery_info="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$recovery_run_id")"
artifacts="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$recovery_run_id/artifacts?per_page=100")"
report_name="$(jq -r '
  [.artifacts[]
    | select(.expired == false)
    | select(.name | test("^supabase-recovery-report-[0-9]+$"))
  ] | sort_by(.created_at) | last | .name // empty
' <<< "$artifacts")"
if [[ ! "$report_name" =~ ^supabase-recovery-report-[0-9]+$ ]]; then
  echo 'No valid restoration report artifact was found.' >&2
  exit 1
fi

backup_run_id="${report_name##*-}"
backup_info="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$backup_run_id")"

jq -e '
  .name == "Encrypted Supabase logical backup"
  and .status == "completed"
  and .conclusion == "success"
  and .head_branch == "main"
' <<< "$backup_info" > /dev/null

jq -e '
  .name == "Verify Supabase backup recovery"
  and .event == "workflow_run"
  and .status == "completed"
  and .conclusion == "success"
  and .head_branch == "main"
' <<< "$recovery_info" > /dev/null

backup_sha="$(jq -r '.head_sha' <<< "$backup_info")"
recovery_sha="$(jq -r '.head_sha' <<< "$recovery_info")"
if [[ -z "$backup_sha" || "$backup_sha" != "$recovery_sha" ]]; then
  echo 'Backup and recovery source commits disagree.' >&2
  exit 1
fi

mkdir -p "$REPORT_DIR"
gh run download "$recovery_run_id" \
  --repo "$GITHUB_REPOSITORY" \
  --name "$report_name" \
  --dir "$REPORT_DIR"

report="$REPORT_DIR/recovery-verification-report.json"
if [[ ! -s "$report" ]]; then
  echo 'Missing attested recovery report.' >&2
  exit 1
fi

python3 scripts/assess_lesson_presentation_backup.py \
  --report "$report" \
  --output "$REPORT_DIR/assessment.json" \
  --as-of-utc "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

jq -e '
  .status == "RECOVERY_EVIDENCE_CURRENT"
  and .verified_restored_catalog_rehearsal == true
  and .production_write_authorized == false
  and .ledger_alignment_verified == false
' "$REPORT_DIR/assessment.json" > /dev/null

echo 'Recovery evidence is current and attested. Independent approval and schema preflight still required.'
