#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ScriptDependencySpec:
    dependency_src: str
    dependency_filename: str
    target_filename: str
    validation_message: str
    require_current_src: bool = False


def compile_script_pattern(filename: str) -> re.Pattern[str]:
    escaped_filename = re.escape(filename)
    return re.compile(
        rf'<script\b[^>]*\bsrc=["\']/?{escaped_filename}(?:\?[^"\']*)?["\'][^>]*>\s*</script>',
        re.IGNORECASE,
    )


def script_insertion_context(html: str, position: int) -> tuple[int, str]:
    line_start = html.rfind("\n", 0, position) + 1
    prefix = html[line_start:position]
    if re.fullmatch(r"[ \t]*", prefix):
        return line_start, prefix
    return position, ""


def dependency_is_current(script_match: re.Match[str], spec: ScriptDependencySpec) -> bool:
    if not spec.require_current_src:
        return True
    return spec.dependency_src in script_match.group(0)


def ensure_dependency_before_target(
    html: str,
    spec: ScriptDependencySpec,
) -> tuple[str, bool]:
    target_pattern = compile_script_pattern(spec.target_filename)
    dependency_pattern = compile_script_pattern(spec.dependency_filename)

    target_script = target_pattern.search(html)
    if not target_script:
        return html, False

    existing_dependency = dependency_pattern.search(html)
    if (
        existing_dependency
        and existing_dependency.start() < target_script.start()
        and dependency_is_current(existing_dependency, spec)
    ):
        return html, False

    html = dependency_pattern.sub("", html)
    target_script = target_pattern.search(html)
    if not target_script:
        return html, False

    insertion_point, indentation = script_insertion_context(html, target_script.start())
    dependency_script = f'{indentation}<script src="{spec.dependency_src}"></script>\n'
    updated = f"{html[:insertion_point]}{dependency_script}{html[insertion_point:]}"
    return updated, True


def validate_dependency_order(html: str, path: Path, spec: ScriptDependencySpec) -> None:
    target_pattern = compile_script_pattern(spec.target_filename)
    dependency_pattern = compile_script_pattern(spec.dependency_filename)

    target_script = target_pattern.search(html)
    if not target_script:
        return

    dependency_script = dependency_pattern.search(html)
    is_valid = (
        dependency_script is not None
        and dependency_script.start() < target_script.start()
        and dependency_is_current(dependency_script, spec)
    )
    if not is_valid:
        raise SystemExit(spec.validation_message.format(path=path))


def process_site(root: Path, spec: ScriptDependencySpec) -> int:
    changed = 0
    for path in root.rglob("*.html"):
        html = path.read_text(encoding="utf-8")
        updated, modified = ensure_dependency_before_target(html, spec)
        validate_dependency_order(updated, path, spec)
        if modified:
            path.write_text(updated, encoding="utf-8")
            changed += 1
    return changed


def resolve_site_root(description: str) -> Path:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--site-root",
        default="_site",
        help="Site root to process. Defaults to _site.",
    )
    args = parser.parse_args()
    root = Path(args.site_root).resolve()
    if not root.is_dir():
        raise SystemExit(f"Site root not found: {root}")
    return root
