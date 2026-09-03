#!/usr/bin/env python3
from __future__ import annotations

from static_build_pipeline import HtmlTransformStats


def format_build_summary(
    public_file_count: int,
    transform_stats: HtmlTransformStats,
    clean_route_aliases: int,
) -> str:
    return (
        f"Static publish directory ready: {public_file_count} public files + _headers; "
        f"site baseline enhanced {transform_stats.enhanced_files} HTML files; "
        f"injected {transform_stats.dependency_injections} dependency scripts; "
        f"materialized {clean_route_aliases} clean route aliases"
    )
