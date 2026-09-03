#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

from html_script_dependency import (
    ScriptDependencySpec,
    ensure_dependency_before_target,
    validate_dependency_order,
)
from static_site_dependencies import (
    ANALYTICS_DEPENDENCIES,
    AUTH_DEPENDENCIES,
    DEPENDENCY_GROUPS,
    PORTAL_HELPER_DEPENDENCIES,
)

RESPONSIVE_COMPAT_HREF = "/responsive_compat.css?v=20260820-1"
RESPONSIVE_COMPAT_LINK = f'  <link rel="stylesheet" href="{RESPONSIVE_COMPAT_HREF}">'
ERROR_MONITOR_SRC = "/error_monitor.js?v=20260820-1"
VIEWPORT_META = '  <meta name="viewport" content="width=device-width, initial-scale=1.0">'
STANDARD_WHATSAPP_URL = "https://wa.me/5534998349756?text=Ol%C3%A1%2C%20Teacher%21%20Vim%20pelo%20site%20e%20gostaria%20de%20conversar%20sobre%20as%20aulas%20de%20ingl%C3%AAs."
WA_ME_RE = re.compile(
    r'https://wa\.me/5534998349756(?:\?[^"\']*)?',
    re.IGNORECASE,
)
API_WHATSAPP_RE = re.compile(
    r'https://api\.whatsapp\.com/send\?[^"\']*phone=5534998349756[^"\']*',
    re.IGNORECASE,
)


def standardize_whatsapp_links(html: str) -> str:
    standardized = WA_ME_RE.sub(STANDARD_WHATSAPP_URL, html)
    return API_WHATSAPP_RE.sub(STANDARD_WHATSAPP_URL, standardized)


def inject_dependencies(
    html: str,
    dependencies: tuple[ScriptDependencySpec, ...],
) -> tuple[str, int]:
    injections = 0
    for dependency in dependencies:
        html, injected = ensure_dependency_before_target(html, dependency)
        if injected:
            injections += 1
    return html, injections


def inject_site_baseline(html: str, relative: Path) -> tuple[str, bool]:
    closing_head = html.lower().find("</head>")
    if closing_head < 0:
        return html, False

    additions: list[str] = []
    lower_html = html.lower()
    if 'name="viewport"' not in lower_html and "name='viewport'" not in lower_html:
        additions.append(VIEWPORT_META)
    if "/responsive_compat.css" not in lower_html:
        additions.append(RESPONSIVE_COMPAT_LINK)
    if "/error_monitor.js" not in lower_html:
        status_attribute = ' data-page-status="404"' if relative.as_posix() == "404.html" else ""
        additions.append(f'  <script defer src="{ERROR_MONITOR_SRC}"{status_attribute}></script>')

    if not additions:
        return html, False

    prefix = html[:closing_head]
    suffix = html[closing_head:]
    separator = "" if prefix.endswith("\n") else "\n"
    injected = "\n".join(additions)
    return f"{prefix}{separator}{injected}\n{suffix}", True


def transform_html(html: str, relative: Path) -> tuple[str, int, bool]:
    transformed = standardize_whatsapp_links(html)
    dependency_injections = 0

    for dependencies in DEPENDENCY_GROUPS:
        transformed, injections = inject_dependencies(transformed, dependencies)
        dependency_injections += injections

    transformed, baseline_enhanced = inject_site_baseline(transformed, relative)
    return transformed, dependency_injections, baseline_enhanced


def validate_html_dependencies(html: str, path: Path) -> None:
    for dependencies in DEPENDENCY_GROUPS:
        for dependency in dependencies:
            validate_dependency_order(html, path, dependency)


def validate_publish_dependencies(publish: Path) -> None:
    for path in publish.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        validate_html_dependencies(html, path.relative_to(publish))
