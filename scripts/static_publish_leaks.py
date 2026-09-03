#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

FORBIDDEN_PUBLISH_SUFFIXES = frozenset({".md", ".sql", ".py", ".yml", ".yaml", ".toml"})


def leaked_operational_files(publish: Path) -> list[str]:
    return [
        path.relative_to(publish).as_posix()
        for path in publish.rglob("*")
        if path.is_file() and path.suffix.lower() in FORBIDDEN_PUBLISH_SUFFIXES
    ]
