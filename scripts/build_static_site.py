#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from static_build_runner import build_static_publish
from static_build_summary import format_build_summary

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"


def main() -> None:
    result = build_static_publish(ROOT, PUBLISH)
    print(
        format_build_summary(
            result.public_file_count,
            result.transform_stats,
            result.clean_route_aliases,
        )
    )


if __name__ == "__main__":
    main()
