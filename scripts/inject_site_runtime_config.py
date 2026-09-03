#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import (
    ScriptDependencySpec,
    process_site as process_html_site,
    resolve_site_root,
)

SITE_RUNTIME_CONFIG_SRC = "/site_runtime_config.js?v=20260903-1"
SPEC = ScriptDependencySpec(
    dependency_src=SITE_RUNTIME_CONFIG_SRC,
    dependency_filename="site_runtime_config.js",
    target_filename="site_footer.js",
    validation_message=(
        "site_runtime_config.js must load with the current version before "
        "site_footer.js in {path}"
    ),
    require_current_src=True,
)


def process_site(root: Path) -> int:
    return process_html_site(root, SPEC)


def main() -> None:
    root = resolve_site_root(
        "Ensure the current site_runtime_config.js loads before site_footer.js."
    )
    changed = process_site(root)
    print(f"Site runtime configuration bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
