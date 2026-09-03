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


def transform_homepage_html(html: str) -> str:
    transformed = BENEFITS_SECTION_PATTERN.sub(BENEFITS_SECTION_REPLACEMENT, html, count=1)
    return BENEFITS_HEADING_PATTERN.sub("\n", transformed, count=1)


def update_homepage(publish: Path) -> None:
    apply_html_transform(
        publish,
        HOMEPAGE_PATH,
        transform_homepage_html,
        missing_message=HOMEPAGE_MISSING_MESSAGE,
    )
