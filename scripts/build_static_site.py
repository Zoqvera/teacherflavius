#!/usr/bin/env python3
from __future__ import annotations

import shutil
from pathlib import Path

from static_site_files import copy_public_files
from static_site_html import transform_html, validate_publish_dependencies
from static_site_routes import materialize_clean_route_aliases
from static_site_validation import install_shared_headers, validate_publish

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"


def main() -> None:
    if PUBLISH.exists():
        shutil.rmtree(PUBLISH)
    PUBLISH.mkdir(parents=True)

    copied_files = copy_public_files(ROOT, PUBLISH)
    enhanced_html = 0
    dependency_injections = 0

    for relative in copied_files:
        if relative.suffix.lower() not in {".html", ".htm"}:
            continue

        destination = PUBLISH / relative
        html = destination.read_text(encoding="utf-8")
        transformed, injections, enhanced = transform_html(html, relative)
        if transformed != html:
            destination.write_text(transformed, encoding="utf-8")
        dependency_injections += injections
        if enhanced:
            enhanced_html += 1

    clean_route_aliases = materialize_clean_route_aliases(ROOT, PUBLISH)
    validate_publish_dependencies(PUBLISH)
    install_shared_headers(ROOT, PUBLISH)
    validate_publish(PUBLISH)

    print(
        f"Static publish directory ready: {len(copied_files)} public files + _headers; "
        f"site baseline enhanced {enhanced_html} HTML files; "
        f"injected {dependency_injections} dependency scripts; "
        f"materialized {clean_route_aliases} clean route aliases"
    )


if __name__ == "__main__":
    main()
