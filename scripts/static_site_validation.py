#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from static_publish_requirements import REQUIRED_PUBLIC_PATHS

FORBIDDEN_PUBLISH_SUFFIXES = frozenset({".md", ".sql", ".py", ".yml", ".yaml", ".toml"})


def missing_required_files(publish: Path) -> list[str]:
    return [relative for relative in REQUIRED_PUBLIC_PATHS if not (publish / relative).is_file()]


def leaked_operational_files(publish: Path) -> list[str]:
    return [
        path.relative_to(publish).as_posix()
        for path in publish.rglob("*")
        if path.is_file() and path.suffix.lower() in FORBIDDEN_PUBLISH_SUFFIXES
    ]


def validate_publish(publish: Path) -> None:
    missing = missing_required_files(publish)
    if missing:
        raise SystemExit(f"Static build missing required public files: {', '.join(missing)}")

    leaked = leaked_operational_files(publish)
    if leaked:
        raise SystemExit(f"Operational files leaked into publish directory: {', '.join(leaked)}")
