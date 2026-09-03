#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from static_site_html import transform_html

HTML_SUFFIXES = frozenset({".html", ".htm"})


@dataclass(frozen=True)
class HtmlTransformStats:
    enhanced_files: int = 0
    dependency_injections: int = 0


def transform_copied_html(publish: Path, copied_files: list[Path]) -> HtmlTransformStats:
    enhanced_files = 0
    dependency_injections = 0

    for relative in copied_files:
        if relative.suffix.lower() not in HTML_SUFFIXES:
            continue

        destination = publish / relative
        html = destination.read_text(encoding="utf-8")
        transformed, injections, enhanced = transform_html(html, relative)
        if transformed != html:
            destination.write_text(transformed, encoding="utf-8")

        dependency_injections += injections
        if enhanced:
            enhanced_files += 1

    return HtmlTransformStats(
        enhanced_files=enhanced_files,
        dependency_injections=dependency_injections,
    )
