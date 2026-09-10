#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass


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
