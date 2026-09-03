#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

RESPONSIVE_COMPAT_HREF = "/responsive_compat.css?v=20260820-1"
RESPONSIVE_COMPAT_LINK = f'  <link rel="stylesheet" href="{RESPONSIVE_COMPAT_HREF}">'
ERROR_MONITOR_SRC = "/error_monitor.js?v=20260820-1"
VIEWPORT_META = '  <meta name="viewport" content="width=device-width, initial-scale=1.0">'


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
