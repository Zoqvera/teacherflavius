#!/usr/bin/env python3
from __future__ import annotations

import html as html_lib
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import urlparse

SITE_ORIGIN = "https://teacherflavius.com"
SOCIAL_IMAGE = f"{SITE_ORIGIN}/assets/social-preview-2026-08.jpg"
SOCIAL_IMAGE_WIDTH = "1200"
SOCIAL_IMAGE_HEIGHT = "630"

TITLE_PATTERN = re.compile(r"<title>(?P<value>.*?)</title>", re.IGNORECASE | re.DOTALL)
DESCRIPTION_PATTERN = re.compile(
    r'<meta\s+name="description"\s+content="(?P<value>.*?)"\s*/?>',
    re.IGNORECASE | re.DOTALL,
)
CANONICAL_PATTERN = re.compile(
    r'<link\s+rel="canonical"\s+href="(?P<value>.*?)"\s*/?>',
    re.IGNORECASE | re.DOTALL,
)
HEAD_CLOSE_PATTERN = re.compile(r"</head>", re.IGNORECASE)
OG_TITLE_PATTERN = re.compile(r'<meta\s+property="og:title"', re.IGNORECASE)


def _extract(pattern: re.Pattern[str], html: str, label: str, page: Path) -> str:
    match = pattern.search(html)
    if not match:
        raise SystemExit(f"{page}: missing {label}")
    value = html_lib.unescape(match.group("value")).strip()
    if not value:
        raise SystemExit(f"{page}: empty {label}")
    return value


def _is_article(canonical: str) -> bool:
    path = urlparse(canonical).path
    return path.startswith("/recursos/") and path != "/recursos/"


def _social_metadata(title: str, description: str, canonical: str) -> str:
    escaped_title = html_lib.escape(title, quote=True)
    escaped_description = html_lib.escape(description, quote=True)
    escaped_canonical = html_lib.escape(canonical, quote=True)
    escaped_image = html_lib.escape(SOCIAL_IMAGE, quote=True)
    og_type = "article" if _is_article(canonical) else "website"

    return "\n".join(
        (
            f'  <meta property="og:type" content="{og_type}">',
            '  <meta property="og:locale" content="pt_BR">',
            '  <meta property="og:site_name" content="Teacher Flávio">',
            f'  <meta property="og:title" content="{escaped_title}">',
            f'  <meta property="og:description" content="{escaped_description}">',
            f'  <meta property="og:url" content="{escaped_canonical}">',
            f'  <meta property="og:image" content="{escaped_image}">',
            f'  <meta property="og:image:width" content="{SOCIAL_IMAGE_WIDTH}">',
            f'  <meta property="og:image:height" content="{SOCIAL_IMAGE_HEIGHT}">',
            f'  <meta property="og:image:alt" content="{escaped_title}">',
            '  <meta name="twitter:card" content="summary_large_image">',
            f'  <meta name="twitter:title" content="{escaped_title}">',
            f'  <meta name="twitter:description" content="{escaped_description}">',
            f'  <meta name="twitter:image" content="{escaped_image}">',
        )
    )


def transform_public_seo_html(html: str, page: Path) -> str:
    if OG_TITLE_PATTERN.search(html):
        return html

    title = _extract(TITLE_PATTERN, html, "<title>", page)
    description = _extract(DESCRIPTION_PATTERN, html, "meta description", page)
    canonical = _extract(CANONICAL_PATTERN, html, "canonical URL", page)

    if not HEAD_CLOSE_PATTERN.search(html):
        raise SystemExit(f"{page}: missing </head>")

    metadata = _social_metadata(title, description, canonical)
    return HEAD_CLOSE_PATTERN.sub(f"{metadata}\n</head>", html, count=1)


def public_pages_from_sitemap(publish: Path) -> list[Path]:
    sitemap = publish / "sitemap.xml"
    if not sitemap.is_file():
        raise SystemExit("Static build missing _site/sitemap.xml")

    try:
        root = ET.parse(sitemap).getroot()
    except ET.ParseError as exc:
        raise SystemExit(f"Invalid sitemap.xml: {exc}") from exc

    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    pages: list[Path] = []
    for node in root.findall(f".//{namespace}loc"):
        url = (node.text or "").strip()
        parsed = urlparse(url)
        if parsed.scheme != "https" or parsed.netloc != "teacherflavius.com":
            raise SystemExit(f"Unexpected sitemap URL: {url}")
        relative = parsed.path.strip("/")
        pages.append(Path("index.html") if not relative else Path(relative) / "index.html")
    return pages


def update_public_seo(publish: Path) -> None:
    for relative in public_pages_from_sitemap(publish):
        target = publish / relative
        if not target.is_file():
            raise SystemExit(f"Static build missing public sitemap page: {target}")
        html = target.read_text(encoding="utf-8")
        transformed = transform_public_seo_html(html, relative)
        if transformed != html:
            target.write_text(transformed, encoding="utf-8")
