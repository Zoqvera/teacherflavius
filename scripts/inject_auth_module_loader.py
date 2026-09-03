#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import (
    ScriptDependencySpec,
    process_site as process_html_site,
    resolve_site_root,
)

MODULE_LOADER_SRC = "/module_loader.js?v=20260902-2"
SPEC = ScriptDependencySpec(
    dependency_src=MODULE_LOADER_SRC,
    dependency_filename="module_loader.js",
    target_filename="auth.js",
    validation_message="module_loader.js must load before auth.js in {path}",
)


def process_site(root: Path) -> int:
    return process_html_site(root, SPEC)


def main() -> None:
    root = resolve_site_root(
        "Ensure module_loader.js is loaded before auth.js in published HTML."
    )
    changed = process_site(root)
    print(f"Auth module loader bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
