#!/usr/bin/env python3
"""Reject regressions to public .html URLs while grandfathering legacy files.

Usage:
    python scripts/validate_clean_urls.py <base_sha> <head_sha>
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path


LEGACY_COMPATIBILITY_FILES = {
    "clean_urls.js",
    "clean_route_loader.js",
}

# New public pages must be directory indexes. 404.html is a GitHub Pages special file.
ALLOWED_NEW_HTML_BASENAMES = {"index.html", "404.html"}

ABSOLUTE_TEACHERFLAVIUS_HTML_URL_RE = re.compile(
    r"https?://(?:www\.)?teacherflavius\.com/[^\s\"'<>]*\.html(?:[?#][^\s\"'<>]*)?",
    re.IGNORECASE,
)
RELATIVE_HTML_URL_RE = re.compile(
    r"(?<![A-Za-z0-9.])(?:/|\./|\.\./)[^\s\"'<>]*\.html(?:[?#][^\s\"'<>]*)?",
    re.IGNORECASE,
)
ATTRIBUTE_RE = re.compile(
    r"(?:href|src|action|content)\s*=\s*[\"']([^\"']+)[\"']",
    re.IGNORECASE,
)
SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+.-]*:")


def run(*args: str) -> str:
    return subprocess.check_output(args, text=True).strip()


def normalize_base(base: str, head: str) -> str:
    if not base or set(base) == {"0"}:
        try:
            return run("git", "rev-parse", f"{head}^")
        except subprocess.CalledProcessError:
            return run("git", "hash-object", "-t", "tree", "/dev/null")
    return base


def changed_files(base: str, head: str) -> list[tuple[str, str]]:
    output = run("git", "diff", "--name-status", "--find-renames", base, head)
    rows: list[tuple[str, str]] = []
    if not output:
        return rows

    for line in output.splitlines():
        parts = line.split("\t")
        status = parts[0]
        path = parts[-1]
        rows.append((status, path))
    return rows


def added_lines(base: str, head: str) -> list[tuple[str, str]]:
    command = [
        "git",
        "diff",
        "--unified=0",
        "--no-color",
        base,
        head,
        "--",
        "*.html",
        "*.js",
        "*.xml",
    ]
    diff = run(*command)
    current_file = ""
    result: list[tuple[str, str]] = []

    for line in diff.splitlines():
        if line.startswith("+++ b/"):
            current_file = line[6:]
            continue
        if not line.startswith("+") or line.startswith("+++"):
            continue
        result.append((current_file, line[1:]))

    return result


def is_internal_html_reference(text: str) -> bool:
    if ABSOLUTE_TEACHERFLAVIUS_HTML_URL_RE.search(text):
        return True
    if RELATIVE_HTML_URL_RE.search(text):
        return True

    for match in ATTRIBUTE_RE.finditer(text):
        value = match.group(1).strip()
        if ".html" not in value.lower():
            continue
        lowered = value.lower()
        if lowered.startswith(("https://teacherflavius.com/", "http://teacherflavius.com/")):
            return True
        if lowered.startswith(("https://www.teacherflavius.com/", "http://www.teacherflavius.com/")):
            return True
        if value.startswith(("/", "./", "../")):
            return True
        if not SCHEME_RE.match(value):
            return True

    return False


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: validate_clean_urls.py <base_sha> <head_sha>")
        return 2

    base = normalize_base(sys.argv[1], sys.argv[2])
    head = sys.argv[2]
    violations: list[str] = []

    for status, path_str in changed_files(base, head):
        path = Path(path_str)
        if status.startswith("A") and path.suffix.lower() == ".html":
            if path.name.lower() not in ALLOWED_NEW_HTML_BASENAMES:
                violations.append(
                    f"Novo arquivo HTML público fora do padrão: {path_str}. "
                    f"Use {path.with_suffix('')}/index.html e publique como /{path.with_suffix('')}/."
                )

    for file_path, text in added_lines(base, head):
        if not file_path or Path(file_path).name in LEGACY_COMPATIBILITY_FILES:
            continue
        if is_internal_html_reference(text):
            violations.append(
                f"Nova referência pública interna com .html em {file_path}: {text.strip()}"
            )

    if violations:
        print("\nClean URL policy: FAILED\n")
        for violation in violations:
            print(f"- {violation}")
        print(
            "\nPadrão obrigatório: rota/index.html no repositório e /rota/ nas URLs públicas."
        )
        return 1

    print("Clean URL policy: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
