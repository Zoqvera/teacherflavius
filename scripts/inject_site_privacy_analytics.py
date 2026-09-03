#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import (
    ScriptDependencySpec,
    process_site as process_html_site,
    resolve_site_root,
)

PRIVACY_ANALYTICS_SRC = "/site_privacy_analytics.js?v=20260902-1"
SPEC = ScriptDependencySpec(
    dependency_src=PRIVACY_ANALYTICS_SRC,
    dependency_filename="site_privacy_analytics.js",
    target_filename="site_footer.js",
    validation_message="site_privacy_analytics.js must load before site_footer.js in {path}",
)


def process_site(root: Path) -> int:
    return process_html_site(root, SPEC)


def main() -> None:
    root = resolve_site_root(
        "Ensure site_privacy_analytics.js loads before site_footer.js."
    )
    changed = process_site(root)
    print(f"Site privacy analytics bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
