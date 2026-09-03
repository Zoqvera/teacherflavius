#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path


def resolve_site_root(description: str) -> Path:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--site-root",
        default="_site",
        help="Site root to process. Defaults to _site.",
    )
    args = parser.parse_args()
    root = Path(args.site_root).resolve()
    if not root.is_dir():
        raise SystemExit(f"Site root not found: {root}")
    return root
