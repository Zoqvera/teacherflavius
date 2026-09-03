#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from production_postprocess_runner import run_production_postprocess

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"


def main() -> None:
    run_production_postprocess(ROOT, PUBLISH)
    print("Production post-processing ready: homepage cleanup + course authority + health.json")


if __name__ == "__main__":
    main()
