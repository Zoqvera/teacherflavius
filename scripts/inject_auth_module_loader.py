#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path

MODULE_LOADER_SRC = "/module_loader.js?v=20260902-2"
AUTH_SCRIPT_RE = re.compile(
    r'<script\b[^>]*\bsrc=["\']/?auth\.js(?:\?[^"\']*)?["\'][^>]*>\s*</script>',
    re.IGNORECASE,
)
MODULE_LOADER_RE = re.compile(
    r'<script\b[^>]*\bsrc=["\']/?module_loader\.js(?:\?[^"\']*)?["\'][^>]*>\s*</script>',
    re.IGNORECASE,
)


def script_indentation(html: str, position: int) -> str:
    line_start = html.rfind("\n", 0, position) + 1
    match = re.match(r"[ \t]*", html[line_start:position])
    return match.group(0) if match else ""


def remove_module_loader_scripts(html: str) -> str:
    return MODULE_LOADER_RE.sub("", html)


def ensure_module_loader_before_auth(html: str) -> tuple[str, bool]:
    auth_script = AUTH_SCRIPT_RE.search(html)
    if not auth_script:
        return html, False

    existing_loader = MODULE_LOADER_RE.search(html)
    if existing_loader and existing_loader.start() < auth_script.start():
        return html, False

    html = remove_module_loader_scripts(html)
    auth_script = AUTH_SCRIPT_RE.search(html)
    if not auth_script:
        return html, False

    indentation = script_indentation(html, auth_script.start())
    loader_script = f'{indentation}<script src="{MODULE_LOADER_SRC}"></script>\n'
    html = f"{html[:auth_script.start()]}{loader_script}{html[auth_script.start():]}"
    return html, True


def validate_order(html: str, path: Path) -> None:
    auth_script = AUTH_SCRIPT_RE.search(html)
    if not auth_script:
        return

    loader_script = MODULE_LOADER_RE.search(html)
    if not loader_script or loader_script.start() > auth_script.start():
        raise SystemExit(f"module_loader.js must load before auth.js in {path}")


def process_site(root: Path) -> int:
    changed = 0
    for path in root.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        updated, modified = ensure_module_loader_before_auth(html)
        validate_order(updated, path)
        if modified:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    return changed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ensure module_loader.js is loaded before auth.js in published HTML."
    )
    parser.add_argument(
        "--site-root",
        default="_site",
        help="Site root to process. Defaults to _site.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    root = Path(args.site_root).resolve()
    if not root.is_dir():
        raise SystemExit(f"Site root not found: {root}")

    changed = process_site(root)
    print(f"Auth module loader bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
