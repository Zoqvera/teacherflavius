#!/usr/bin/env python3
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CleanRouteAlias:
    source: str
    target: str
    canonical_path: str
    stylesheet: str | None = None
    script: str | None = None


ALIASES: tuple[CleanRouteAlias, ...] = (
    CleanRouteAlias(
        source="mensalidades.html",
        target="mensalidades/index.html",
        canonical_path="/mensalidades/",
        stylesheet="/mensalidades/mensalidades_visual.css?v=20260901-1",
        script="/mensalidades/mensalidades_visual.js?v=20260901-1",
    ),
)
