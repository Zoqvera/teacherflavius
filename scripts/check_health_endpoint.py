#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from health_endpoint_contract import validate_health

DEFAULT_TIMEOUT_SECONDS = 15


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate the production health endpoint.")
    parser.add_argument("url", help="Health endpoint URL")
    parser.add_argument("--attempts", type=int, default=1, help="Maximum validation attempts")
    parser.add_argument("--delay", type=float, default=5.0, help="Seconds between attempts")
    return parser.parse_args()


def fetch_health(url: str) -> dict[str, Any]:
    request = Request(url, headers={"User-Agent": "teacherflavius-health-check/1.0"})
    with urlopen(request, timeout=DEFAULT_TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected HTTP status: {response.status}")
        return json.loads(response.read().decode("utf-8"))


def wait_for_healthy_endpoint(url: str, attempts: int, delay_seconds: float) -> dict[str, Any]:
    if attempts < 1:
        raise ValueError("attempts must be at least 1")

    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            payload = fetch_health(url)
            validate_health(payload)
            return payload
        except (HTTPError, URLError, TimeoutError, RuntimeError, ValueError, json.JSONDecodeError) as error:
            last_error = error
            if attempt == attempts:
                break
            print(f"Health check attempt {attempt}/{attempts} failed: {error}")
            time.sleep(delay_seconds)

    raise SystemExit(f"Health endpoint did not become ready after {attempts} attempts: {last_error}")


def main() -> None:
    args = parse_args()
    payload = wait_for_healthy_endpoint(args.url, args.attempts, args.delay)
    print(
        "Production health OK:",
        payload.get("service"),
        payload.get("hosting", "generated-build"),
    )


if __name__ == "__main__":
    main()
