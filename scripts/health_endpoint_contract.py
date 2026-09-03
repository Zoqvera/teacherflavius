#!/usr/bin/env python3
from __future__ import annotations

from typing import Any

EXPECTED_SERVICE = "teacherflavius.com"


def validate_health(payload: dict[str, Any]) -> None:
    if payload.get("status") != "ok":
        raise ValueError(f"Invalid health status: {payload!r}")
    if payload.get("service") != EXPECTED_SERVICE:
        raise ValueError(f"Unexpected service identifier: {payload!r}")
