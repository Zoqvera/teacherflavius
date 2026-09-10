#!/usr/bin/env python3
from __future__ import annotations

from clean_route_alias_catalog import CleanRouteAlias


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
    html = ensure_after(source_html, "<head>", '\n  <base href="/">')
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
