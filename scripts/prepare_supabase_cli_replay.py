#!/usr/bin/env python3
"""Stage a CLI-native migration replay in a disposable directory only.

The live supabase/migrations directory and production migration ledger are
immutable. This generates a temporary fixture for testing Supabase CLI's own
migration/seed execution; it is NOT an automatic-branch deployment strategy.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from scripts.compile_canonical_supabase_bootstrap import write_outputs

BOOTSTRAP_VERSION = "20261013000000"
ASSERTION_VERSION = "20261013000001"
BOOTSTRAP_FILENAME = f"{BOOTSTRAP_VERSION}_canonical_disposable_schema.sql"
ASSERTION_FILENAME = f"{ASSERTION_VERSION}_verify_disposable_schema.sql"

# The canonical bootstrap includes reviewed Cron definitions. Deactivate
# every application-owned Cron job in the SAME SQL migration before commit.
# Secrets are never copied from production into these ephemeral fixtures.
STOP_CRON = """
-- Preview-only safety: do not schedule provider calls or recurring jobs.
do $preview_cron_guard$
declare
  owned_job record;
begin
  for owned_job in select jobid from cron.job where active loop
    perform cron.alter_job(owned_job.jobid, active := false);
  end loop;
  if exists (select 1 from cron.job where active) then
    raise exception 'A scheduled job remained active in disposable fixture';
  end if;
end;
$preview_cron_guard$;
"""

VERIFY_SCHEMA = """
-- Intentionally read-only: verify the preceding bootstrap applied first.
do $preview_schema_assert$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.monthly_tuition') is null
     or to_regclass('public.teacher_classes') is null
     or to_regclass('private.lesson_credits') is null then
    raise exception 'Canonical preview bootstrap did not create required tables';
  end if;
  if exists(select 1 from cron.job where active) then
    raise exception 'Cron must be disabled before test data is seeded';
  end if;
end;
$preview_schema_assert$;
"""

SYNTHETIC_SEED = """
-- Disposable test fixtures only; never copy a production profile or payment.
-- No Auth users or payments are created. The two test class numbers are reserved
-- for this disposable CLI fixture and must never reach production.
insert into public.teacher_classes
  (class_number, class_name, class_type, class_weekday, class_start_time,
   is_active, makeup_slots_enabled)
values
  (970001, 'Synthetic preview quintet', 'quintet', 5, '18:00', true, false),
  (970002, 'Synthetic preview individual', 'individual', 3, '10:00', true, false);
"""


def assert_safe_paths(repository_root: Path, staging_root: Path) -> None:
    repository_root = repository_root.resolve()
    staging_root = staging_root.resolve()

    if staging_root == repository_root or staging_root.is_relative_to(repository_root):
        raise ValueError("Staging directory must be outside the Git checkout.")
    if repository_root.is_relative_to(staging_root):
        raise ValueError("Staging root cannot contain the Git checkout.")
    if staging_root == Path("/"):
        raise ValueError("Staging root cannot be a system directory.")
    if not (repository_root / "supabase" / "migrations").is_dir():
        raise ValueError("Source repository migrations directory is missing.")


def stage_replay(repository_root: Path, staging_root: Path) -> dict:
    """Write only to an already initialized, empty CLI fixture directory."""
    assert_safe_paths(repository_root, staging_root)
    sql_dir = staging_root / "supabase"
    if not (sql_dir / "config.toml").is_file():
        raise ValueError("Initialize an isolated Supabase CLI project first.")
    migrations_dir = sql_dir / "migrations"
    migrations_dir.mkdir(parents=True, exist_ok=True)
    if any(migrations_dir.iterdir()) or (sql_dir / "seed.sql").exists():
        raise ValueError("Disposable fixture must not contain existing SQL migrations or seed.")

    artifact_dir = staging_root / "artifacts"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    compiled_sql = artifact_dir / "compiled.sql"
    manifest_file = artifact_dir / "manifest.json"
    fingerprint_file = artifact_dir / "fingerprint.sql"
    write_outputs(repository_root, compiled_sql, manifest_file, fingerprint_file)

    migration = migrations_dir / BOOTSTRAP_FILENAME
    migration.write_text(compiled_sql.read_text(encoding="utf-8") + STOP_CRON, encoding="utf-8")
    (migrations_dir / ASSERTION_FILENAME).write_text(VERIFY_SCHEMA, encoding="utf-8")
    (sql_dir / "seed.sql").write_text(SYNTHETIC_SEED, encoding="utf-8")
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    report = {
        "mode": "isolated-cli-replay-only",
        "migration_versions": [BOOTSTRAP_VERSION, ASSERTION_VERSION],
        "reviewed_overlays": manifest["overlay_count"],
        "production_ledger_mutated": False,
        "uses_production_data": False,
        "cron_disabled_in_migration": True,
        "seed_record_count": 2,
    }
    (artifact_dir / "cli-replay.json").write_text(
        json.dumps(report, indent=2) + "\n", encoding="utf-8"
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--staging-root", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = stage_replay(args.repo_root, args.staging_root)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
