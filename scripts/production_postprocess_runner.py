#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from production_course_authority import update_course_authority
from production_health import write_health_check
from production_homepage import update_homepage


def run_production_postprocess(root: Path, publish: Path) -> None:
    if not publish.is_dir():
        raise SystemExit("Run scripts/build_static_site.py before production post-processing")

    update_homepage(publish)
    update_course_authority(publish)
    write_health_check(root, publish)
