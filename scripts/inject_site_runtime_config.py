#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from pathlib import Path

SITE_RUNTIME_CONFIG_SRC = "/site_runtime_config.js?v=20260902-1"
SITE_FOOTER_RE = re.compile(
    r'<script\b[^>]*\bsrc=["\']/?site_footer\.js(?:\?[^"\']*)?["\'][^>]*>\s*</script>',
    re.IGNORECASE,
)
SITE_RUNTIME_CONFIG_RE = re.compile(
    r'<script\b[^>]*\bsrc=["\']/?site_runtime_config\.js(?:\?[^"\']*)?["\'][^>]*>\s*</script>',
    re.IGNORECASE,
)


def script_indentation(html: str, position: int) -> str:
    line_start = html.rfind("\n", 0, position) + 1
    match = re.match(r"[ \t]*", html[line_start:position])
    return match.group(0) if match else ""


def remove_runtime_config_scripts(html: str) -> str:
    return SITE_RUNTIME_CONFIG_RE.sub("", html)


def ensure_runtime_config_before_footer(html: str) -> tuple[str, bool]:
    footer_script = SITE_FOOTER_RE.search(html)
    if not footer_script:
        return html, False

    existing = SITE_RUNTIME_CONFIG_RE.search(html)
    if existing and existing.start() < footer_script.start():
        return html, False

    html = remove_runtime_config_scripts(html)
    footer_script = SITE_FOOTER_RE.search(html)
    if not footer_script:
        return html, False

    indentation = script_indentation(html, footer_script.start())
    dependency = f'{indentation}<script src="{SITE_RUNTIME_CONFIG_SRC}"></script>\n'
    html = f"{html[:footer_script.start()]}{dependency}{html[footer_script.start():]}"
    return html, True


def validate_order(html: str, path: Path) -> None:
    footer_script = SITE_FOOTER_RE.search(html)
    if not footer_script:
        return

    dependency = SITE_RUNTIME_CONFIG_RE.search(html)
    if not dependency or dependency.start() > footer_script.start():
        raise SystemExit(f"site_runtime_config.js must load before site_footer.js in {path}")


def process_site(root: Path) -> int:
    changed = 0
    for path in root.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        updated, modified = ensure_runtime_config_before_footer(html)
        validate_order(updated, path)
        if modified:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    return changed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ensure site_runtime_config.js loads before site_footer.js."
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
    print(f"Site runtime configuration bootstrap: {changed} HTML file(s) updated.")


if __name__ == "__main__":
    main()
