#!/usr/bin/env python3
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from git_revision import current_commit_sha
from production_health_payload import build_health_payload as build_payload


def build_health_payload(root: Path, generated_at: datetime | None = None) -> dict[str, str]:
    timestamp = generated_at or datetime.now(timezone.utc)
    return build_payload(current_commit_sha(root), timestamp)


def write_health_check(root: Path, publish: Path) -> None:
    payload = build_health_payload(root)
    (publish / "health.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
