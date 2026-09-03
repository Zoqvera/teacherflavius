#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from google_tag_manager_html import GTM_CONTAINER_ID, HTML_OPEN_RE, inject_gtm, validate_gtm

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SITE_ROOT = ROOT / "_site"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inject and validate Google Tag Manager in static HTML documents."
    )
    parser.add_argument(
        "--site-root",
        type=Path,
        default=DEFAULT_SITE_ROOT,
        help="Directory containing HTML documents. Defaults to _site.",
    )
    return parser.parse_args()


def resolve_site_root(site_root: Path) -> Path:
    resolved = site_root if site_root.is_absolute() else ROOT / site_root
    return resolved.resolve()


def iter_html_documents(site_root: Path):
    for path in sorted(site_root.rglob("*.html")):
        if path.is_file():
            yield path


def process_site(site_root: Path) -> tuple[int, int]:
    injected = 0
    documents = 0

    for path in iter_html_documents(site_root):
        relative = path.relative_to(site_root)
        html = path.read_text(encoding="utf-8")
        if not HTML_OPEN_RE.search(html):
            continue

        documents += 1
        transformed, changed = inject_gtm(html, relative)
        validate_gtm(transformed, relative)

        if changed:
            path.write_text(transformed, encoding="utf-8")
            injected += 1

    return documents, injected


def main() -> None:
    args = parse_args()
    site_root = resolve_site_root(args.site_root)
    if not site_root.is_dir():
        raise SystemExit(f"Site root does not exist: {site_root}")

    documents, injected = process_site(site_root)
    if documents == 0:
        raise SystemExit(f"No HTML documents found in site root: {site_root}")

    print(
        f"Google Tag Manager {GTM_CONTAINER_ID} validated in {documents} HTML documents; "
        f"injected into {injected} documents"
    )


if __name__ == "__main__":
    main()
