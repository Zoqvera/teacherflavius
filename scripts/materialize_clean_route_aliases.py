#!/usr/bin/env python3
"""Materialize static clean-route aliases from legacy HTML pages."""

from __future__ import annotations

import argparse
from pathlib import Path

from clean_route_alias_catalog import ALIASES, CleanRouteAlias
from clean_route_alias_html import build_alias_html


def materialize_alias(site_root: Path, alias: CleanRouteAlias) -> bool:
    source_path = site_root / alias.source
    target_path = site_root / alias.target
    source_html = source_path.read_text(encoding="utf-8")
    generated_html = build_alias_html(source_html, alias)

    current_html = target_path.read_text(encoding="utf-8") if target_path.exists() else None
    if current_html == generated_html:
        return False

    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(generated_html, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--site-root", default=".")
    args = parser.parse_args()

    site_root = Path(args.site_root).resolve()
    changed = [alias.target for alias in ALIASES if materialize_alias(site_root, alias)]
    if changed:
        print("Clean-route aliases materialized:", ", ".join(changed))
    else:
        print("Clean-route aliases already materialized.")


if __name__ == "__main__":
    main()
