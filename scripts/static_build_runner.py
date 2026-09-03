#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from static_build_pipeline import HtmlTransformStats, transform_copied_html
from static_dependency_runtime import validate_publish_dependencies
from static_hosting_headers import install_shared_headers
from static_publish_workspace import prepare_publish_directory
from static_site_files import copy_public_files
from static_site_routes import materialize_clean_route_aliases
from static_site_validation import validate_publish


@dataclass(frozen=True)
class StaticBuildResult:
    public_file_count: int
    transform_stats: HtmlTransformStats
    clean_route_aliases: int


def build_static_publish(root: Path, publish: Path) -> StaticBuildResult:
    prepare_publish_directory(publish)

    copied_files = copy_public_files(root, publish)
    transform_stats = transform_copied_html(publish, copied_files)
    clean_route_aliases = materialize_clean_route_aliases(root, publish)

    validate_publish_dependencies(publish)
    install_shared_headers(root, publish)
    validate_publish(publish)

    return StaticBuildResult(
        public_file_count=len(copied_files),
        transform_stats=transform_stats,
        clean_route_aliases=clean_route_aliases,
    )
