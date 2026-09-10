#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

from production_html_transform import apply_html_transform

BENEFITS_SECTION_PATTERN = re.compile(
    r'<section\s+class="section"\s+aria-labelledby="benefits-title">'
)
BENEFITS_HEADING_PATTERN = re.compile(
    r'\s*<h2\s+id="benefits-title">Inglês online com professor, prática e acompanhamento\.</h2>\s*'
)
BENEFITS_SECTION_REPLACEMENT = '<section class="section" aria-label="Como funcionam as aulas">'
HOMEPAGE_PATH = Path("index.html")
HOMEPAGE_MISSING_MESSAGE = "Static build missing _site/index.html"
VIDEO_THUMBNAIL_BACKGROUND_PATTERN = re.compile(
    r",url\(['\"]?/assets/home-free-class-thumbnail\.jpg(?:\?v=[^)'\"\s]+)?['\"]?\)\s*center/cover\s+no-repeat",
    re.IGNORECASE,
)
VIDEO_TRIGGER_OPEN = (
    '<button class="video-trigger" id="homeVideoTrigger" type="button" '
    'aria-label="Reproduzir aula gratuita do Teacher Flávio">'
)
VIDEO_THUMBNAIL_IMAGE = (
    '<img class="video-trigger-image" '
    'src="/assets/home-free-class-thumbnail.jpg?v=20260908-1" '
    'alt="" loading="lazy" decoding="async">'
)
VIDEO_THUMBNAIL_STYLE = (
    ".video-trigger-image{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;"
    "z-index:0;filter:brightness(.58);transition:filter .18s ease}"
    ".video-trigger>*:not(.video-trigger-image){position:relative;z-index:1}"
    ".video-trigger:hover .video-trigger-image{filter:brightness(.7)}"
)
VIDEO_HOVER_STYLE_MARKER = ".video-trigger:hover{"


def lazy_load_video_thumbnail(html: str) -> str:
    transformed = VIDEO_THUMBNAIL_BACKGROUND_PATTERN.sub("", html)
    if 'class="video-trigger-image"' in transformed:
        return transformed

    transformed = transformed.replace(
        VIDEO_TRIGGER_OPEN,
        VIDEO_TRIGGER_OPEN + "\n            " + VIDEO_THUMBNAIL_IMAGE,
        1,
    )
    transformed = transformed.replace(
        VIDEO_HOVER_STYLE_MARKER,
        VIDEO_THUMBNAIL_STYLE + VIDEO_HOVER_STYLE_MARKER,
        1,
    )
    return transformed


def transform_homepage_html(html: str) -> str:
    transformed = BENEFITS_SECTION_PATTERN.sub(BENEFITS_SECTION_REPLACEMENT, html, count=1)
    transformed = BENEFITS_HEADING_PATTERN.sub("\n", transformed, count=1)
    return lazy_load_video_thumbnail(transformed)


def update_homepage(publish: Path) -> None:
    apply_html_transform(
        publish,
        HOMEPAGE_PATH,
        transform_homepage_html,
        missing_message=HOMEPAGE_MISSING_MESSAGE,
    )
