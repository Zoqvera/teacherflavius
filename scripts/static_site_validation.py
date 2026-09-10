#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from static_publish_leaks import leaked_operational_files
from static_publish_requirements import missing_required_files


def validate_publish(publish: Path) -> None:
    missing = missing_required_files(publish)
    if missing:
        raise SystemExit(f"Static build missing required public files: {', '.join(missing)}")

    leaked = leaked_operational_files(publish)
    if leaked:
        raise SystemExit(f"Operational files leaked into publish directory: {', '.join(leaked)}")
