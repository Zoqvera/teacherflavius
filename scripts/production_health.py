#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path

SERVICE_NAME = "teacherflavius.com"


def current_commit_sha(root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def build_health_payload(root: Path, generated_at: datetime | None = None) -> dict[str, str]:
    timestamp = generated_at or datetime.now(timezone.utc)
    return {
        "status": "ok",
        "service": SERVICE_NAME,
        "commit": current_commit_sha(root),
        "generated_at": timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def write_health_check(root: Path, publish: Path) -> None:
    payload = build_health_payload(root)
    (publish / "health.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
