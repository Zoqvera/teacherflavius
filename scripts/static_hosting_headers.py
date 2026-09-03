#!/usr/bin/env python3
from __future__ import annotations

import shutil
from pathlib import Path

SHARED_HEADERS_SOURCE = Path("netlify") / "_headers"
PUBLISH_HEADERS_NAME = "_headers"


def install_shared_headers(root: Path, publish: Path) -> None:
    source = root / SHARED_HEADERS_SOURCE
    if not source.is_file():
        raise SystemExit("Missing shared hosting headers at netlify/_headers")
    shutil.copy2(source, publish / PUBLISH_HEADERS_NAME)
