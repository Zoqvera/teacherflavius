#!/usr/bin/env python3
from __future__ import annotations

import shutil
from pathlib import Path


def prepare_publish_directory(publish: Path) -> None:
    if publish.exists():
        shutil.rmtree(publish)
    publish.mkdir(parents=True)
