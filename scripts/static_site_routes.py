#!/usr/bin/env python3
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

CLEAN_ROUTE_PAIR_RE = re.compile(
    r'^\s*"(?P<route>/[^"]+/)"\s*:\s*"(?P<source>/[^"]+\.html)"\s*,?\s*$',
    re.MULTILINE,
)


@dataclass(frozen=True)
class CleanRouteAlias:
    route: str
    source: Path
    target: Path


def ensure_root_base(html: str) -> str:
    if re.search(r"<base\s", html, re.IGNORECASE):
        return html
    head = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not head:
        return html
    return f'{html[:head.end()]}\n  <base href="/">{html[head.end():]}'


def parse_clean_route_aliases(loader: str) -> tuple[CleanRouteAlias, ...]:
    aliases: list[CleanRouteAlias] = []
    for match in CLEAN_ROUTE_PAIR_RE.finditer(loader):
        route = match.group("route")
        source = Path(match.group("source").lstrip("/"))
        target = Path(route.strip("/")) / "index.html"
        aliases.append(CleanRouteAlias(route=route, source=source, target=target))
    return tuple(aliases)


def materialize_alias(publish: Path, alias: CleanRouteAlias) -> bool:
    if alias.source == alias.target:
        return False

    source = publish / alias.source
    target = publish / alias.target
    if not source.is_file():
        raise SystemExit(
            f"Clean route source is missing: {alias.source.as_posix()} for {alias.route}"
        )
    if target.is_file():
        return False

    target.parent.mkdir(parents=True, exist_ok=True)
    html = source.read_text(encoding="utf-8")
    target.write_text(ensure_root_base(html), encoding="utf-8")
    return True


def materialize_clean_route_aliases(root: Path, publish: Path) -> int:
    loader_path = root / "clean_route_loader.js"
    if not loader_path.is_file():
        raise SystemExit("Missing clean_route_loader.js used to build clean route aliases")

    aliases = parse_clean_route_aliases(loader_path.read_text(encoding="utf-8"))
    if not aliases:
        raise SystemExit("No clean route aliases found in clean_route_loader.js")

    return sum(1 for alias in aliases if materialize_alias(publish, alias))
