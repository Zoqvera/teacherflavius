#!/usr/bin/env python3
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

BLOCKED_TOP_LEVEL = frozenset({
    ".git",
    ".github",
    ".netlify",
    "_site",
    "docs",
    "netlify",
    "scripts",
    "supabase",
    "tests",
})

SKIP_NAMES = frozenset({"CNAME", ".nojekyll"})
PUBLIC_SPECIAL_NAMES = frozenset({"_redirects"})

PUBLIC_SUFFIXES = frozenset({
    ".html", ".htm",
    ".css", ".js", ".mjs", ".json", ".xml", ".txt",
    ".ico", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
    ".pdf",
    ".mp3", ".wav", ".ogg", ".m4a",
    ".mp4", ".webm",
    ".woff", ".woff2", ".ttf", ".otf",
})


def tracked_files(root: Path) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=root,
        check=True,
        capture_output=True,
    )
    return [Path(raw.decode("utf-8")) for raw in result.stdout.split(b"\0") if raw]


def is_public(path: Path) -> bool:
    if not path.parts:
        return False
    if path.parts[0] in BLOCKED_TOP_LEVEL:
        return False
    if path.name in SKIP_NAMES:
        return False
    if any(part.startswith(".") for part in path.parts):
        return False
    return path.name in PUBLIC_SPECIAL_NAMES or path.suffix.lower() in PUBLIC_SUFFIXES


def public_tracked_files(root: Path) -> list[Path]:
    return [relative for relative in tracked_files(root) if is_public(relative) and (root / relative).is_file()]


def copy_public_files(root: Path, publish: Path) -> list[Path]:
    copied: list[Path] = []
    for relative in public_tracked_files(root):
        source = root / relative
        destination = publish / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied.append(relative)
    return copied
