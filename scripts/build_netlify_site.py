#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from static_hosting_headers import install_shared_headers
from static_html_baseline import inject_site_baseline
from static_publish_leaks import leaked_operational_files
from static_publish_workspace import prepare_publish_directory
from static_site_files import copy_public_files
from static_whatsapp_links import standardize_whatsapp_links

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"
HTML_SUFFIXES = frozenset({".html", ".htm"})
NETLIFY_HEADERS_MISSING_MESSAGE = "Missing netlify/_headers"

NETLIFY_REQUIRED_PUBLIC_PATHS = (
    "index.html",
    "404.html",
    "robots.txt",
    "sitemap.xml",
    "error_monitor.js",
    "_redirects",
)


def enhance_copied_html(publish: Path, copied_files: list[Path]) -> int:
    enhanced_html = 0
    for relative in copied_files:
        if relative.suffix.lower() not in HTML_SUFFIXES:
            continue

        destination = publish / relative
        html = destination.read_text(encoding="utf-8")
        original_html = html
        html = standardize_whatsapp_links(html)
        html, enhanced = inject_site_baseline(html, relative)

        if html != original_html:
            destination.write_text(html, encoding="utf-8")
        if enhanced:
            enhanced_html += 1

    return enhanced_html


def validate_netlify_publish(root: Path, publish: Path) -> None:
    missing = [relative for relative in NETLIFY_REQUIRED_PUBLIC_PATHS if not (publish / relative).is_file()]
    if missing:
        rendered = [str((publish / relative).relative_to(root)) for relative in missing]
        raise SystemExit(f"Netlify build missing required public files: {', '.join(rendered)}")

    if not (publish / "responsive_compat.css").is_file():
        raise SystemExit("Netlify build missing responsive_compat.css")

    leaked = leaked_operational_files(publish)
    if leaked:
        raise SystemExit(f"Operational files leaked into publish directory: {', '.join(leaked)}")


def main() -> None:
    prepare_publish_directory(PUBLISH)
    copied_files = copy_public_files(ROOT, PUBLISH)
    enhanced_html = enhance_copied_html(PUBLISH, copied_files)

    install_shared_headers(ROOT, PUBLISH, missing_message=NETLIFY_HEADERS_MISSING_MESSAGE)
    validate_netlify_publish(ROOT, PUBLISH)

    print(
        f"Netlify publish directory ready: {len(copied_files)} public files + _headers; "
        f"site baseline enhanced {enhanced_html} HTML files"
    )


if __name__ == "__main__":
    main()
