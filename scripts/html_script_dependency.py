#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from html_script_dependency_transform import (
    ensure_dependency_before_target,
    validate_dependency_order,
)
from script_dependency_spec import ScriptDependencySpec


def process_site(root: Path, spec: ScriptDependencySpec) -> int:
    changed = 0
    for path in root.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        updated, modified = ensure_dependency_before_target(html, spec)
        validate_dependency_order(updated, path, spec)
        if modified:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    return changed


def resolve_site_root(description: str) -> Path:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--site-root",
        default="_site",
        help="Site root to process. Defaults to _site.",
    )
    args = parser.parse_args()
    root = Path(args.site_root).resolve()
    if not root.is_dir():
        raise SystemExit(f"Site root not found: {root}")
    return root
