#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from html_script_dependency import (
    ScriptDependencySpec,
    ensure_dependency_before_target,
    validate_dependency_order,
)
from static_site_dependencies import DEPENDENCY_GROUPS

DependencyGroup = tuple[ScriptDependencySpec, ...]
DependencyGroups = tuple[DependencyGroup, ...]


def inject_dependencies(html: str, dependencies: DependencyGroup) -> tuple[str, int]:
    injections = 0
    transformed = html
    for dependency in dependencies:
        transformed, injected = ensure_dependency_before_target(transformed, dependency)
        if injected:
            injections += 1
    return transformed, injections


def inject_dependency_groups(
    html: str,
    dependency_groups: DependencyGroups = DEPENDENCY_GROUPS,
) -> tuple[str, int]:
    transformed = html
    injections = 0
    for dependencies in dependency_groups:
        transformed, group_injections = inject_dependencies(transformed, dependencies)
        injections += group_injections
    return transformed, injections


def validate_html_dependencies(
    html: str,
    path: Path,
    dependency_groups: DependencyGroups = DEPENDENCY_GROUPS,
) -> None:
    for dependencies in dependency_groups:
        for dependency in dependencies:
            validate_dependency_order(html, path, dependency)


def validate_publish_dependencies(publish: Path) -> None:
    for path in publish.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        validate_html_dependencies(html, path.relative_to(publish))
