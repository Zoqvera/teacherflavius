#!/usr/bin/env python3
"""Compile one deterministic, disposable-only Supabase schema bootstrap.

The existing proven baseline-restore workflow is the single source of truth
for SQL file order and the expected catalog fingerprint query.
This does not modify production migration history.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

WORKFLOW = ".github/workflows/validate-supabase-baseline.yml"
BASELINE_PREFIX = "supabase/baseline/"
EXPECTED_FIRST = "supabase/baseline/10_public_schema.sql"
EXPECTED_LAST = "supabase/baseline/405_restore_auth_account_health_run_storage.sql"

# Active runtime guard. A comment saying "disposable" is not a safe check.
# Reject an existing application schema *before* executing any of the
# reviewed CREATE/ALTER statements. Do not rely on an environment variable,
# which a misconfigured production process could accidentally inherit.
FRESH_DATABASE_GUARD = """
-- Fail closed when the application is already installed.
do $canonical_fresh_database_guard$
begin
  if to_regclass('public.profiles') is not null
     or to_regclass('public.teacher_classes') is not null
     or to_regclass('public.monthly_tuition') is not null
     or to_regclass('public.class_students') is not null
     or to_regclass('private.lesson_credits') is not null then
    raise exception 'Refusing canonical bootstrap: application schema already exists';
  end if;
end;
$canonical_fresh_database_guard$;
"""



def parse_baseline_order(workflow: str) -> tuple[str, ...]:
    """Read the exact order used by CI rather than maintaining two lists."""
    lines = workflow.splitlines()
    for index, line in enumerate(lines):
        if line.strip() != r"for file in \ " .rstrip():
            continue
        paths: list[str] = []
        for item in lines[index + 1 :]:
            cleaned = item.strip()
            if cleaned == "do":
                break
            value = cleaned.removesuffix("\\").strip()
            if not value.startswith(BASELINE_PREFIX) or not value.endswith(".sql"):
                raise ValueError("Unexpected command inside authoritative baseline file list.")
            if not re.fullmatch(r"supabase/baseline/[A-Za-z0-9_]+\.sql", value):
                raise ValueError("Invalid baseline file path.")
            paths.append(value)
        else:
            raise ValueError("Baseline restore loop has no closing 'do'.")

        if len(paths) < 60 or paths[0] != EXPECTED_FIRST or paths[-1] != EXPECTED_LAST:
            raise ValueError("Baseline restore order was unexpectedly changed.")
        if len(set(paths)) != len(paths):
            raise ValueError("Duplicate baseline overlay in authoritative restore list.")
        return tuple(paths)
    raise ValueError("Could not locate baseline restore loop.")


def extract_fingerprint_query(workflow: str) -> str:
    """Extract the same SQL used to compare the regular baseline with production."""
    marker = "- name: Compare restored catalog with production fingerprint"
    if workflow.count(marker) != 1:
        raise ValueError("Expected one catalog fingerprint comparison.")
    compare_step = workflow.split(marker, 1)[1]
    lines = compare_step.splitlines()
    start = next(
        (i for i, line in enumerate(lines) if line.strip().startswith("select json_build_object(")),
        None,
    )
    if start is None:
        raise ValueError("Missing fingerprint query.")
    end = next(
        (i for i in range(start + 1, len(lines)) if lines[i].strip() == "SQL"),
        None,
    )
    if end is None:
        raise ValueError("Missing fingerprint query terminator.")
    sql = "\n".join(line.strip() if line.lstrip().startswith("select ") else line[10:] for line in lines[start:end])
    if "from pg_class" not in sql or "vault_secret_names" not in sql:
        raise ValueError("Unexpected fingerprint SQL.")
    if not sql.rstrip().endswith(");"):
        raise ValueError("Fingerprint query was truncated.")
    return sql + "\n"


def compile_bootstrap(repo_root: Path) -> tuple[str, dict]:
    content = (repo_root / WORKFLOW).read_text(encoding="utf-8")
    paths = parse_baseline_order(content)
    blocks = [
        "-- DISPOSABLE DATABASE ONLY. DO NOT APPLY TO EXISTING PRODUCTION DATABASE.\n",
        "-- Generated from the reviewed Supabase reconstruction overlays.\n",
        "-- This is NOT safe for the Supabase GitHub automatic-branch migration folder.\n",
        "-- Preview-only outbound Cron and provider integrations must be isolated.\n\n",
        FRESH_DATABASE_GUARD,
        "\n",
    ]
    included = []
    for path in paths:
        source = repo_root / path
        if not source.is_file():
            raise ValueError(f"Baseline file is missing: {path}")
        sql = source.read_text(encoding="utf-8")
        if not sql.strip():
            raise ValueError(f"Baseline file is empty: {path}")
        included.append({
            "file": path,
            "sha256": hashlib.sha256(sql.encode("utf-8")).hexdigest(),
        })
        blocks.extend([f"\n-- BEGIN REVIEWED OVERLAY: {path}\n", sql, "\n", f"-- END REVIEWED OVERLAY: {path}\n"])
    text = "".join(blocks)
    manifest = {
        "mode": "disposable-only",
        "source": WORKFLOW,
        "overlays": included,
        "overlay_count": len(included),
        "bootstrap_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
    }
    return text, manifest


def write_outputs(root: Path, output: Path, manifest: Path, fingerprint: Path) -> None:
    root = root.resolve()
    output = output.resolve()
    migrations_dir = root / "supabase" / "migrations"
    if output == migrations_dir or migrations_dir in output.parents:
        raise ValueError("Refusing to write generated bootstrap into production migrations.")
    compiled, information = compile_bootstrap(root)
    for target in (output, manifest, fingerprint):
        target.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(compiled, encoding="utf-8")
    manifest.write_text(json.dumps(information, indent=2) + "\n", encoding="utf-8")
    fingerprint.write_text(
        extract_fingerprint_query((root / WORKFLOW).read_text(encoding="utf-8")),
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--fingerprint-sql", type=Path, required=True)
    args = parser.parse_args()
    try:
        write_outputs(args.repo_root, args.output, args.manifest, args.fingerprint_sql)
    except (OSError, ValueError) as error:
        parser.error(str(error))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
