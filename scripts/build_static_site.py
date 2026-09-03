#!/usr/bin/env python3
from __future__ import annotations

import re
import shutil
from pathlib import Path

from static_site_files import copy_public_files
from static_site_html import transform_html, validate_publish_dependencies
from static_site_validation import install_shared_headers, validate_publish

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"
CLEAN_ROUTE_LOADER = ROOT / "clean_route_loader.js"
CLEAN_ROUTE_PAIR_RE = re.compile(
    r'^\s*"(?P<route>/[^"]+/)"\s*:\s*"(?P<source>/[^"]+\.html)"\s*,?\s*$',
    re.MULTILINE,
)


def ensure_root_base(html: str) -> str:
    if re.search(r"<base\s", html, re.IGNORECASE):
        return html
    head = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not head:
        return html
    return f'{html[:head.end()]}\n  <base href="/">{html[head.end():]}'


def materialize_clean_route_aliases() -> int:
    if not CLEAN_ROUTE_LOADER.is_file():
        raise SystemExit("Missing clean_route_loader.js used to build clean route aliases")

    loader = CLEAN_ROUTE_LOADER.read_text(encoding="utf-8")
    pairs = list(CLEAN_ROUTE_PAIR_RE.finditer(loader))
    if not pairs:
        raise SystemExit("No clean route aliases found in clean_route_loader.js")

    created = 0
    for match in pairs:
        route = match.group("route")
        source_relative = Path(match.group("source").lstrip("/"))
        target_relative = Path(route.strip("/")) / "index.html"

        if source_relative == target_relative:
            continue

        source = PUBLISH / source_relative
        target = PUBLISH / target_relative
        if not source.is_file():
            raise SystemExit(
                f"Clean route source is missing: {source_relative.as_posix()} for {route}"
            )
        if target.is_file():
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        html = source.read_text(encoding="utf-8")
        target.write_text(ensure_root_base(html), encoding="utf-8")
        created += 1

    return created


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

    clean_route_aliases = materialize_clean_route_aliases()
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
