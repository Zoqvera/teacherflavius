#!/usr/bin/env python3
from __future__ import annotations

from datetime import datetime, timezone

SERVICE_NAME = "teacherflavius.com"


def format_utc_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def build_health_payload(commit_sha: str, generated_at: datetime) -> dict[str, str]:
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "commit": commit_sha,
        "generated_at": format_utc_timestamp(generated_at),
    }
