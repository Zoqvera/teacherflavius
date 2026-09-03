#!/usr/bin/env python3
from __future__ import annotations

import shutil
from pathlib import Path

REQUIRED_PUBLIC_PATHS = (
    "index.html",
    "404.html",
    "robots.txt",
    "sitemap.xml",
    "error_monitor.js",
    "resource_waiter.js",
    "supabase_client_service.js",
    "auth_navigation_service.js",
    "student_data_utils.js",
    "student_enrollment_service.js",
    "analytics.js",
    "analytics_utils.js",
    "analytics_acquisition.js",
    "analytics_forms.js",
    "analytics_payments.js",
    "quero-conhecer/index.html",
    "cadastro/index.html",
    "meu-progresso/index.html",
    "responsive_compat.css",
    "_headers",
)

FORBIDDEN_PUBLISH_SUFFIXES = frozenset({".md", ".sql", ".py", ".yml", ".yaml", ".toml"})


def install_shared_headers(root: Path, publish: Path) -> None:
    source = root / "netlify" / "_headers"
    if not source.is_file():
        raise SystemExit("Missing shared hosting headers at netlify/_headers")
    shutil.copy2(source, publish / "_headers")


def missing_required_files(publish: Path) -> list[str]:
    return [relative for relative in REQUIRED_PUBLIC_PATHS if not (publish / relative).is_file()]


def leaked_operational_files(publish: Path) -> list[str]:
    return [
        path.relative_to(publish).as_posix()
        for path in publish.rglob("*")
        if path.is_file() and path.suffix.lower() in FORBIDDEN_PUBLISH_SUFFIXES
    ]


def validate_publish(publish: Path) -> None:
    missing = missing_required_files(publish)
    if missing:
        raise SystemExit(f"Static build missing required public files: {', '.join(missing)}")

    leaked = leaked_operational_files(publish)
    if leaked:
        raise SystemExit(f"Operational files leaked into publish directory: {', '.join(leaked)}")
