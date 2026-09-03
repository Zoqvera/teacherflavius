#!/usr/bin/env python3
from __future__ import annotations

import subprocess
from pathlib import Path


def current_commit_sha(root: Path) -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()
