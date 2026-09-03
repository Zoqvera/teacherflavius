#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from static_dependency_runtime import inject_dependency_groups
from static_html_baseline import inject_site_baseline
from static_site_dependencies import (
    ANALYTICS_DEPENDENCIES,
    AUTH_DEPENDENCIES,
    DEPENDENCY_GROUPS,
    PORTAL_HELPER_DEPENDENCIES,
)
from static_whatsapp_links import STANDARD_WHATSAPP_URL, standardize_whatsapp_links


def transform_html(html: str, relative: Path) -> tuple[str, int, bool]:
    transformed = standardize_whatsapp_links(html)
    transformed, dependency_injections = inject_dependency_groups(transformed)
    transformed, baseline_enhanced = inject_site_baseline(transformed, relative)
    return transformed, dependency_injections, baseline_enhanced
