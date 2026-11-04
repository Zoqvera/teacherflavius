#!/usr/bin/env python3
"""Read-only availability checks for public JavaScript and CSS resources."""

from __future__ import annotations

import argparse
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

SITE_ORIGIN = "https://teacherflavius.com"
REQUEST_TIMEOUT_SECONDS = 8
USER_AGENT = "TeacherFlavius-Asset-Availability/1.0"


@dataclass(frozen=True)
class StaticAsset:
    path: str
    expected_types: frozenset[str]


JAVASCRIPT_TYPES = frozenset({
    "text/javascript",
    "application/javascript",
    "application/x-javascript",
    "text/ecmascript",
    "application/ecmascript",
})
CSS_TYPES = frozenset({"text/css"})

ASSETS = (
    StaticAsset("/error_monitor.js", JAVASCRIPT_TYPES),
    StaticAsset("/student_access_tracker.js", JAVASCRIPT_TYPES),
    StaticAsset("/student_policy_notice_loader.js", JAVASCRIPT_TYPES),
    StaticAsset("/site_page_context.js", JAVASCRIPT_TYPES),
    StaticAsset("/animated_cards.css", CSS_TYPES),
    StaticAsset("/course_tools.css", CSS_TYPES),
)


class AssetCheckError(Exception):
    """One resource failed an availability or delivery contract."""


def validate_delivery(asset: StaticAsset, status: int, content_type: str, prefix: bytes) -> None:
    if status != 200:
        raise AssetCheckError(f"HTTP {status}")

    media_type = content_type.partition(";")[0].strip().lower()
    if media_type not in asset.expected_types:
        raise AssetCheckError(f"unexpected Content-Type: {media_type or 'missing'}")

    if not prefix.strip():
        raise AssetCheckError("empty response body")

    start = prefix.lstrip().lower()
    if start.startswith((b"<!doctype html", b"<html", b"<head")):
        raise AssetCheckError("HTML fallback instead of requested asset")


def probe_asset(
    asset: StaticAsset,
    opener: Callable = urlopen,
    origin: str = SITE_ORIGIN,
) -> str:
    url = origin.rstrip("/") + asset.path
    request = Request(url, headers={"User-Agent": USER_AGENT}, method="GET")
    try:
        with opener(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            status = response.status
            headers = response.headers
            content_type = headers.get("Content-Type", "")
            prefix = response.read(256)
            validate_delivery(asset, status, content_type, prefix)
            cache_state = headers.get("CF-Cache-Status", "unknown")
            return f"HTTP {status}; {content_type}; cache={cache_state}"
    except HTTPError as error:
        raise AssetCheckError(f"HTTP {error.code}") from error
    except (URLError, TimeoutError, OSError) as error:
        raise AssetCheckError(f"network failure: {type(error).__name__}") from error


def check_local_build(root: Path, assets: tuple[StaticAsset, ...] = ASSETS) -> None:
    root = root.resolve()
    for asset in assets:
        local_file = root / asset.path.lstrip("/")
        if not local_file.is_file() or local_file.stat().st_size == 0:
            raise AssetCheckError(f"built resource is missing or empty: {asset.path}")
        print(f"Local build OK: {asset.path}")


def check_remote_assets(
    assets: tuple[StaticAsset, ...] = ASSETS,
    attempts: int = 3,
    delay_seconds: float = 2.0,
    probe: Callable[[StaticAsset], str] = probe_asset,
    sleeper: Callable[[float], None] = time.sleep,
) -> None:
    if attempts < 1 or delay_seconds < 0:
        raise ValueError("attempts must be positive and delay must be nonnegative")

    failed = []
    for asset in assets:
        for attempt in range(1, attempts + 1):
            try:
                result = probe(asset)
                print(f"Asset OK: {asset.path} ({result})")
                break
            except AssetCheckError as error:
                print(f"Asset {asset.path} attempt {attempt}/{attempts}: {error}")
                if attempt == attempts:
                    failed.append(asset.path)
                else:
                    sleeper(delay_seconds)

    if failed:
        raise AssetCheckError("Unavailable or invalid assets: " + ", ".join(failed))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate critical static resources.")
    parser.add_argument("--local-root", type=Path, help="Validate local generated build instead of production.")
    parser.add_argument("--attempts", type=int, default=3)
    parser.add_argument("--delay", type=float, default=2.0)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        if args.local_root:
            check_local_build(args.local_root)
        else:
            check_remote_assets(attempts=args.attempts, delay_seconds=args.delay)
    except (AssetCheckError, ValueError) as error:
        raise SystemExit(f"Static asset check failed: {error}") from error


if __name__ == "__main__":
    main()
