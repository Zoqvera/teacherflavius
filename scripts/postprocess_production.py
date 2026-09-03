#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from production_content import update_course_authority, update_homepage
from production_health import write_health_check

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"


def main() -> None:
    if not PUBLISH.is_dir():
        raise SystemExit("Run scripts/build_static_site.py before production post-processing")

    update_homepage(PUBLISH)
    update_course_authority(PUBLISH)
    write_health_check(ROOT, PUBLISH)
    print("Production post-processing ready: homepage cleanup + course authority + health.json")


if __name__ == "__main__":
    main()
