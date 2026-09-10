#!/usr/bin/env python3
"""Validate deterministic page-weight budgets for critical static routes."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import unquote, urlsplit

KIB = 1024
CSS_URL_PATTERN = re.compile(r"url\(\s*['\"]?([^)'\"]+)", re.IGNORECASE)


@dataclass(frozen=True)
class Budget:
    html_kib: int
    css_kib: int
    javascript_kib: int
    eager_media_kib: int
    direct_requests: int


@dataclass(frozen=True)
class Metrics:
    html_bytes: int
    css_bytes: int
    javascript_bytes: int
    eager_media_bytes: int
    direct_requests: int


BUDGETS = {
    "/": Budget(48, 32, 64, 64, 16),
    "/curso-de-ingles-online/": Budget(64, 40, 72, 64, 20),
    "/login/": Budget(16, 24, 24, 24, 8),
    "/acesso-aluno/": Budget(12, 16, 24, 24, 6),
}


class ResourceParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stylesheets: set[str] = set()
        self.scripts: set[str] = set()
        self.eager_media: set[str] = set()
        self.direct_resources: set[str] = set()
        self.inline_css_parts: list[str] = []
        self._inside_style = False

    @staticmethod
    def _attrs(attributes: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key.lower(): value or "" for key, value in attributes}

    def handle_starttag(self, tag: str, attributes: list[tuple[str, str | None]]) -> None:
        attrs = self._attrs(attributes)
        normalized_tag = tag.lower()

        if normalized_tag == "style":
            self._inside_style = True
            return

        if normalized_tag == "link" and attrs.get("rel", "").lower() == "stylesheet":
            self._record(attrs.get("href"), self.stylesheets)
            return

        if normalized_tag == "script" and attrs.get("src"):
            self._record(attrs.get("src"), self.scripts)
            return

        if normalized_tag in {"img", "source", "video", "audio"}:
            source = attrs.get("src") or attrs.get("poster")
            if source and attrs.get("loading", "").lower() != "lazy":
                self._record(source, self.eager_media)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "style":
            self._inside_style = False

    def handle_data(self, data: str) -> None:
        if self._inside_style and data:
            self.inline_css_parts.append(data)

    def _record(self, value: str | None, target: set[str]) -> None:
        if not value or not is_local_resource(value):
            return
        normalized = strip_query(value)
        target.add(normalized)
        self.direct_resources.add(normalized)

    @property
    def inline_css(self) -> str:
        return "\n".join(self.inline_css_parts)


def is_local_resource(value: str) -> bool:
    parsed = urlsplit(value.strip())
    return parsed.scheme == "" and parsed.netloc == "" and not value.startswith("data:")


def strip_query(value: str) -> str:
    parsed = urlsplit(value.strip())
    return unquote(parsed.path)


def route_file(root: Path, route: str) -> Path:
    if route == "/":
        return root / "index.html"
    return root / route.strip("/") / "index.html"


def resolve_resource(root: Path, page_file: Path, resource: str) -> Path:
    if resource.startswith("/"):
        candidate = root / resource.lstrip("/")
    else:
        candidate = page_file.parent / resource
    return candidate.resolve()


def resource_size(root: Path, page_file: Path, resource: str) -> int:
    candidate = resolve_resource(root, page_file, resource)
    try:
        candidate.relative_to(root.resolve())
    except ValueError as error:
        raise ValueError(f"Resource escapes site root: {resource}") from error
    return candidate.stat().st_size if candidate.is_file() else 0


def css_urls(css_text: str, root: Path, css_base: Path) -> set[str]:
    media: set[str] = set()
    for match in CSS_URL_PATTERN.finditer(css_text):
        value = match.group(1).strip()
        if not is_local_resource(value) or value.startswith("#"):
            continue
        css_relative = strip_query(value)
        if css_relative.startswith("/"):
            media.add(css_relative)
            continue
        resolved = (css_base / css_relative).resolve()
        try:
            relative = resolved.relative_to(root.resolve())
        except ValueError:
            continue
        media.add("/" + relative.as_posix())
    return media


def css_eager_media(root: Path, page_file: Path, stylesheets: set[str]) -> set[str]:
    media: set[str] = set()
    for stylesheet in stylesheets:
        css_file = resolve_resource(root, page_file, stylesheet)
        if not css_file.is_file():
            continue
        text = css_file.read_text(encoding="utf-8", errors="ignore")
        media.update(css_urls(text, root, css_file.parent))
    return media


def measure_page(root: Path, route: str) -> Metrics:
    page_file = route_file(root, route)
    if not page_file.is_file():
        raise FileNotFoundError(f"Missing critical route file: {page_file}")

    parser = ResourceParser()
    parser.feed(page_file.read_text(encoding="utf-8", errors="ignore"))

    stylesheet_media = css_eager_media(root, page_file, parser.stylesheets)
    inline_media = css_urls(parser.inline_css, root, page_file.parent)
    eager_media = set(parser.eager_media) | stylesheet_media | inline_media
    direct_resources = set(parser.direct_resources) | stylesheet_media | inline_media

    return Metrics(
        html_bytes=page_file.stat().st_size,
        css_bytes=sum(resource_size(root, page_file, value) for value in parser.stylesheets),
        javascript_bytes=sum(resource_size(root, page_file, value) for value in parser.scripts),
        eager_media_bytes=sum(resource_size(root, page_file, value) for value in eager_media),
        direct_requests=len(direct_resources),
    )


def budget_failures(route: str, metrics: Metrics, budget: Budget) -> list[str]:
    checks = (
        ("HTML", metrics.html_bytes, budget.html_kib * KIB, "bytes"),
        ("CSS", metrics.css_bytes, budget.css_kib * KIB, "bytes"),
        ("JavaScript", metrics.javascript_bytes, budget.javascript_kib * KIB, "bytes"),
        ("eager media", metrics.eager_media_bytes, budget.eager_media_kib * KIB, "bytes"),
        ("direct requests", metrics.direct_requests, budget.direct_requests, "count"),
    )
    failures: list[str] = []
    for label, actual, maximum, unit in checks:
        if actual > maximum:
            failures.append(f"{route} {label}: {actual} {unit} > budget {maximum} {unit}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default="_site", help="Static site root")
    parser.add_argument("--json", dest="json_path", help="Optional JSON output path")
    args = parser.parse_args()

    root = Path(args.root)
    if not root.is_dir():
        raise SystemExit(f"Static site root does not exist: {root}")

    report: dict[str, dict[str, object]] = {}
    failures: list[str] = []

    for route, budget in BUDGETS.items():
        metrics = measure_page(root, route)
        route_failures = budget_failures(route, metrics, budget)
        failures.extend(route_failures)
        report[route] = {
            "metrics": asdict(metrics),
            "budget": asdict(budget),
            "passed": not route_failures,
        }
        print(
            f"{route}: html={metrics.html_bytes / KIB:.1f}KiB "
            f"css={metrics.css_bytes / KIB:.1f}KiB "
            f"js={metrics.javascript_bytes / KIB:.1f}KiB "
            f"eager_media={metrics.eager_media_bytes / KIB:.1f}KiB "
            f"requests={metrics.direct_requests}"
        )

    if args.json_path:
        Path(args.json_path).write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")

    if failures:
        print("\nPerformance budget: FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("\nPerformance budget: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
