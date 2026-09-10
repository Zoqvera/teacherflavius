#!/usr/bin/env python3
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

HtmlTransform = Callable[[str], str]


def apply_html_transform(
    publish: Path,
    relative: Path,
    transform: HtmlTransform,
    *,
    missing_message: str,
) -> None:
    target = publish / relative
    if not target.is_file():
        raise SystemExit(missing_message)

    html = target.read_text(encoding="utf-8")
    transformed = transform(html)
    if transformed != html:
        target.write_text(transformed, encoding="utf-8")
