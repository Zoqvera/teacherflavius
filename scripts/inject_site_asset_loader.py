#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import resolve_site_root
from html_script_dependency_runtime import process_site as process_html_site
from script_dependency_spec import ScriptDependencySpec

SITE_ASSET_LOADER_SRC = "/site_asset_loader.js?v=20260902-1"
SPEC = ScriptDependencySpec(
    dependency_src=SITE_ASSET_LOADER_SRC,
    dependency_filename="site_asset_loader.js",
    target_filename="site_footer.js",
    validation_message="site_asset_loader.js must load before site_footer.js in {path}",
)


def process_site(root: Path) -> int:
    return process_html_site(root, SPEC)


def main() -> None:
    root = resolve_site_root("Ensure site_asset_loader.js loads before site_footer.js.")
    changed = process_site(root)
    print(f"Site asset loader bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
