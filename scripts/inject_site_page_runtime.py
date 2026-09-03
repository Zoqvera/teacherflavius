#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import process_site as process_html_site, resolve_site_root
from script_dependency_spec import ScriptDependencySpec

SITE_PAGE_RUNTIME_SRC = "/site_page_runtime.js?v=20260903-1"
SPEC = ScriptDependencySpec(
    dependency_src=SITE_PAGE_RUNTIME_SRC,
    dependency_filename="site_page_runtime.js",
    target_filename="site_footer.js",
    validation_message="site_page_runtime.js must load before site_footer.js in {path}",
)


def process_site(root: Path) -> int:
    return process_html_site(root, SPEC)


def main() -> None:
    root = resolve_site_root("Ensure site_page_runtime.js loads before site_footer.js.")
    changed = process_site(root)
    print(f"Site page runtime bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
