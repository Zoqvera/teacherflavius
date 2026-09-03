#!/usr/bin/env python3
from __future__ import annotations

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
