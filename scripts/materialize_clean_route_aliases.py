#!/usr/bin/env python3
"""Materialize static clean-route aliases from legacy HTML pages."""

from __future__ import annotations

import argparse
from pathlib import Path

from clean_route_alias_catalog import ALIASES, CleanRouteAlias


def ensure_after(text: str, marker: str, addition: str) -> str:
    if addition.strip() in text:
        return text
    if marker not in text:
        raise ValueError(f"Marcador obrigatório ausente: {marker}")
    return text.replace(marker, marker + addition, 1)


def ensure_before(text: str, marker: str, addition: str) -> str:
    if addition.strip() in text:
        return text
    if marker not in text:
        raise ValueError(f"Marcador obrigatório ausente: {marker}")
    return text.replace(marker, addition + marker, 1)


def build_alias_html(source_html: str, alias: CleanRouteAlias) -> str:
    html = source_html
    html = ensure_after(html, "<head>", '\n  <base href="/">')
    html = ensure_after(
        html,
        "<head>",
        f'\n  <link rel="canonical" href="https://teacherflavius.com{alias.canonical_path}">',
    )
    html = html.replace('href="/professor.html"', 'href="/professor/"')
    html = html.replace('href="professor.html"', 'href="/professor/"')

    if alias.stylesheet:
        html = ensure_before(
            html,
            "</head>",
            f'  <link rel="stylesheet" href="{alias.stylesheet}">\n',
        )
    if alias.script:
        html = ensure_before(
            html,
            "</body>",
            f'  <script src="{alias.script}"></script>\n',
        )
    return html


def materialize_alias(site_root: Path, alias: CleanRouteAlias) -> bool:
    source_path = site_root / alias.source
    target_path = site_root / alias.target
    source_html = source_path.read_text(encoding="utf-8")
    generated_html = build_alias_html(source_html, alias)

    current_html = target_path.read_text(encoding="utf-8") if target_path.exists() else None
    if current_html == generated_html:
        return False

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(generated_html, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-root", default=".")
    args = parser.parse_args()

    site_root = Path(args.site_root).resolve()
    changed = [alias.target for alias in ALIASES if materialize_alias(site_root, alias)]
    if changed:
        print("Clean-route aliases materialized:", ", ".join(changed))
    else:
        print("Clean-route aliases already materialized.")


if __name__ == "__main__":
    main()
