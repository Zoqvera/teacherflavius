#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import (
    ScriptDependencySpec,
    ensure_dependency_before_target,
    validate_dependency_order,
)
from static_html_baseline import inject_site_baseline
from static_site_dependencies import (
    ANALYTICS_DEPENDENCIES,
    AUTH_DEPENDENCIES,
    DEPENDENCY_GROUPS,
    PORTAL_HELPER_DEPENDENCIES,
)
from static_whatsapp_links import STANDARD_WHATSAPP_URL, standardize_whatsapp_links


def inject_dependencies(
    html: str,
    dependencies: tuple[ScriptDependencySpec, ...],
) -> tuple[str, int]:
    injections = 0
    for dependency in dependencies:
        html, injected = ensure_dependency_before_target(html, dependency)
        if injected:
            injections += 1
    return html, injections


def transform_html(html: str, relative: Path) -> tuple[str, int, bool]:
    transformed = standardize_whatsapp_links(html)
    dependency_injections = 0

    for dependencies in DEPENDENCY_GROUPS:
        transformed, injections = inject_dependencies(transformed, dependencies)
        dependency_injections += injections

    transformed, baseline_enhanced = inject_site_baseline(transformed, relative)
    return transformed, dependency_injections, baseline_enhanced


def validate_html_dependencies(html: str, path: Path) -> None:
    for dependencies in DEPENDENCY_GROUPS:
        for dependency in dependencies:
            validate_dependency_order(html, path, dependency)


def validate_publish_dependencies(publish: Path) -> None:
    for path in publish.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        validate_html_dependencies(html, path.relative_to(publish))
