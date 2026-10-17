#!/usr/bin/env bash
# Verifica evidência originada dos workflows reais, nunca de conteúdo fornecido pelo navegador.
set -euo pipefail

readonly BACKUP_RUN_ID=39043019631
readonly RECOVERY_RUN_ID=39043160705
readonly REPORT_NAME="supabase-recovery-report-${BACKUP_RUN_ID}"
readonly REPORT_DIR="${RUNNER_TEMP:?}/lesson-presentation-recovery"

if [[ -z "${GH_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" ]]; then
  echo 'Missing GitHub Actions read-only credentials.' >&2
  exit 1
fi

backup_info="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$BACKUP_RUN_ID")"
recovery_info="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$RECOVERY_RUN_ID")"

jq -e '
  .name == "Encrypted Supabase logical backup"
  and .status == "completed"
  and .conclusion == "success"
  and .head_branch == "main"
' <<< "$backup_info" > /dev/null

jq -e '
  .name == "Verify Supabase backup recovery"
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
gh run download "$RECOVERY_RUN_ID" \
  --repo "$GITHUB_REPOSITORY" \
  --name "$REPORT_NAME" \
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

echo 'Backup recovery and migration rehearsal evidence accepted. Schema preflight remains mandatory.'
