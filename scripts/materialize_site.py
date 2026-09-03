#!/usr/bin/env python3
from __future__ import annotations

import argparse
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Sequence

ROOT = Path(__file__).resolve().parents[1]
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_SITE_ROOT = ROOT / "_site"


@dataclass(frozen=True)
class MaterializationStep:
    script_name: str


PUBLISH_STEPS: tuple[MaterializationStep, ...] = (
    MaterializationStep("inject_site_asset_loader.py"),
    MaterializationStep("inject_site_runtime_config.py"),
    MaterializationStep("inject_site_page_runtime.py"),
    MaterializationStep("inject_site_privacy_analytics.py"),
    MaterializationStep("inject_auth_module_loader.py"),
    MaterializationStep("inject_google_tag_manager.py"),
)

GITHUB_PAGES_STEPS: tuple[MaterializationStep, ...] = (
    MaterializationStep("inject_auth_module_loader.py"),
    MaterializationStep("inject_site_asset_loader.py"),
    MaterializationStep("inject_site_runtime_config.py"),
    MaterializationStep("inject_site_page_runtime.py"),
    MaterializationStep("inject_site_privacy_analytics.py"),
    MaterializationStep("inject_google_tag_manager.py"),
    MaterializationStep("materialize_clean_route_aliases.py"),
)

PROFILES: dict[str, tuple[MaterializationStep, ...]] = {
    "publish": PUBLISH_STEPS,
    "github-pages": GITHUB_PAGES_STEPS,
}

CommandRunner = Callable[..., subprocess.CompletedProcess[str]]


def resolve_site_root(site_root: Path) -> Path:
    resolved = site_root if site_root.is_absolute() else ROOT / site_root
    return resolved.resolve()


def build_command(step: MaterializationStep, site_root: Path) -> list[str]:
    return [
        sys.executable,
        str(SCRIPT_DIR / step.script_name),
        "--site-root",
        str(site_root),
    ]


def materialize_site(
    site_root: Path,
    steps: Sequence[MaterializationStep],
    runner: CommandRunner = subprocess.run,
) -> None:
    if not site_root.is_dir():
        raise SystemExit(f"Site root does not exist: {site_root}")

    for step in steps:
        runner(build_command(step, site_root), check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the ordered HTML materialization pipeline for a static site."
    )
    parser.add_argument(
        "--site-root",
        type=Path,
        default=DEFAULT_SITE_ROOT,
        help="Directory containing the static site. Defaults to _site.",
    )
    parser.add_argument(
        "--profile",
        choices=tuple(PROFILES),
        default="publish",
        help="Materialization profile to run. Defaults to publish.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    site_root = resolve_site_root(args.site_root)
    materialize_site(site_root, PROFILES[args.profile])
    print(f"Site materialization profile '{args.profile}' completed for {site_root}")


if __name__ == "__main__":
    main()
