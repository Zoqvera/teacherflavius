#!/usr/bin/env python3
"""Run browser viewport checks using only synthetic Homework fixtures."""

from __future__ import annotations

import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "homeworks-stage5-visual" / "index.html"
ARTIFACTS = ROOT / "_homeworks_visual_artifacts"
VIEWPORTS = (("mobile", 390, 844), ("compact", 320, 740), ("desktop", 1280, 900))
SCENARIOS = (
    ("reading", "list"),
    ("writing", "list"),
    ("reading", "initial"),
    ("grammar", "initial"),
    ("writing", "initial"),
    ("writing", "submitted"),
    ("writing", "privacy_review"),
    ("writing", "evaluated"),
    ("reading", "evaluated"),
)


def find_browser() -> str:
    for executable in ("google-chrome-stable", "google-chrome", "chromium", "chromium-browser"):
        browser = shutil.which(executable)
        if browser:
            return browser
    raise RuntimeError("Chrome/Chromium not installed; cannot claim a browser-based UI pass.")


def dimensions(image: Path) -> tuple[int, int]:
    with image.open("rb") as file:
        header = file.read(24)
    if header[:8] != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"Invalid browser screenshot: {image.name}")
    return struct.unpack(">II", header[16:24])


def assert_scenario(browser: str, viewport: tuple[str, int, int],
                    activity: str, state: str) -> None:
    label, width, height = viewport
    artifact = ARTIFACTS / f"{label}-{activity}-{state}.png"
    url = FIXTURE.as_uri() + "?" + urlencode({"activity": activity, "state": state})
    cmd = [
        browser, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--no-first-run", "--no-default-browser-check",
        "--allow-file-access-from-files", "--hide-scrollbars",
        "--force-device-scale-factor=1",
        "--virtual-time-budget=15000",
        f"--window-size={width},{height}",
        f"--screenshot={artifact}", "--dump-dom", url,
    ]
    # Shared CI runners intermittently return an empty DOM before scripts mount.
    # Retry only an unready DOM; a true FAIL remains immediate.
    for attempt in range(3):
        try:
            run = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True,
                                 timeout=60, check=False)
        except subprocess.TimeoutExpired as error:
            if attempt < 2:
                continue  # Cold Chrome startup can stall on a shared CI runner.
            raise RuntimeError(
                f"Browser timed out: {label} {activity}/{state}"
            ) from error
        if run.returncode != 0:
            raise RuntimeError(
                f"Chrome failed: {label} {activity}/{state} (exit={run.returncode})"
            )
        status = re.search(r'data-qa-result="([^"]+)"', run.stdout)
        if status is not None and status.group(1) == "PASS":
            break
        if status is not None and status.group(1) == "FAIL":
            raise AssertionError(
                f"UI assertions failed: {label} {activity}/{state}, result=FAIL"
            )
        # Only retry when async rendering was not ready; never mask real FAIL.
    else:
        raise AssertionError(
            f"UI never became ready: {label} {activity}/{state}"
        )
    if not artifact.is_file():
        raise RuntimeError(f"No screenshot generated: {artifact.name}")
    screenshot_width, _ = dimensions(artifact)
    # Chrome may enforce a 500px window minimum in some headless versions.
    if screenshot_width < width:
        raise RuntimeError(f"Viewport shrank unexpectedly: {artifact.name}")
    print(f"PASS {label} ({width}x{height}) {activity}/{state} / {artifact.name}")


def main() -> int:
    browser = find_browser()
    ARTIFACTS.mkdir(exist_ok=True)
    print(f"Browser: {Path(browser).name}")
    count = 0
    for viewport in VIEWPORTS:
        for activity, state in SCENARIOS:
            assert_scenario(browser, viewport, activity, state)
            count += 1
    print(f"PASS: {count} headless browser scenarios with actual student UI and no network.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, AssertionError) as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        sys.exit(1)
