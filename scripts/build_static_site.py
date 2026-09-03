#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from static_build_pipeline import transform_copied_html
from static_build_summary import format_build_summary
from static_dependency_runtime import validate_publish_dependencies
from static_hosting_headers import install_shared_headers
from static_publish_workspace import prepare_publish_directory
from static_site_files import copy_public_files
from static_site_routes import materialize_clean_route_aliases
from static_site_validation import validate_publish

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"


def main() -> None:
    prepare_publish_directory(PUBLISH)

    copied_files = copy_public_files(ROOT, PUBLISH)
    transform_stats = transform_copied_html(PUBLISH, copied_files)
    clean_route_aliases = materialize_clean_route_aliases(ROOT, PUBLISH)

    validate_publish_dependencies(PUBLISH)
    install_shared_headers(ROOT, PUBLISH)
    validate_publish(PUBLISH)

    print(format_build_summary(len(copied_files), transform_stats, clean_route_aliases))


if __name__ == "__main__":
    main()
