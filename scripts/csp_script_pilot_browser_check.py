#!/usr/bin/env python3
"""Verify the enrollment CSP in a real browser without accessing production data."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from google_tag_manager_html import GTM_HEAD_SNIPPET

ROOT = Path(__file__).resolve().parents[1]
PILOT = ROOT / "matricula80" / "index.html"

CSP_META_PATTERN = re.compile(
    r'<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"',
    re.IGNORECASE,
)
SCRIPT_PATTERN = re.compile(r"<script>([\s\S]*?)</script>")


def find_browser() -> str:
    for name in ("google-chrome-stable", "google-chrome", "chromium", "chromium-browser"):
        executable = shutil.which(name)
        if executable:
            return executable
    raise RuntimeError("Chromium is unavailable for CSP browser validation.")


def read_policy() -> str:
    html = PILOT.read_text(encoding="utf-8")
    match = CSP_META_PATTERN.search(html)
    if not match:
        raise RuntimeError("Enrollment CSP meta tag is missing.")
    return match.group(1)


def create_fixture(directory: Path) -> None:
    policy = read_policy()
    inline_scripts = SCRIPT_PATTERN.findall(GTM_HEAD_SNIPPET)
    if len(inline_scripts) != 2:
        raise RuntimeError("Unexpected Google Consent / GTM bootstraps.")

    (directory / "trusted.js").write_text(
        'window.__trustedLoaded = true;\n', encoding="utf-8"
    )

    (directory / "probe.js").write_text(
        """
(function () {
  "use strict";

  let evalBlocked = false;
  let functionBlocked = false;
  try { eval("window.__evalExecuted = true"); }
  catch (_) { evalBlocked = true; }
  try { new Function("window.__functionExecuted = true")(); }
  catch (_) { functionBlocked = true; }

  document.getElementById("inlineEvent").click();

  const consent = window.dataLayer && window.dataLayer[0];
  const consentLoaded = !!consent &&
    consent[0] === "consent" && consent[1] === "default";

  const success = window.__trustedLoaded === true &&
    consentLoaded &&
    typeof window.__unapprovedInline === "undefined" &&
    typeof window.__inlineEventExecuted === "undefined" &&
    typeof window.__dataScriptExecuted === "undefined" &&
    typeof window.__evalExecuted === "undefined" &&
    typeof window.__functionExecuted === "undefined" &&
    evalBlocked && functionBlocked;

  document.body.setAttribute("data-csp-test", success ? "PASS" : "FAIL");
})();
""",
        encoding="utf-8",
    )

    page = (
        '<!doctype html><html><head><meta charset="utf-8">'
        f'<meta http-equiv="Content-Security-Policy" content="{policy}">'
        '<script src="/trusted.js"></script>'
        '<script>window.__unapprovedInline = true;</script>'
        f'<script>{inline_scripts[0]}</script>'
        '<script src="data:text/javascript,window.__dataScriptExecuted=true"></script>'
        '</head><body>'
        '<button id="inlineEvent" onclick="window.__inlineEventExecuted=true">Try</button>'
        '<script src="/probe.js"></script>'
        '</body></html>'
    )
    (directory / "index.html").write_text(page, encoding="utf-8")


def test_browser(browser: str, directory: Path) -> None:
    handler = partial(SimpleHTTPRequestHandler, directory=str(directory))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    worker = Thread(target=server.serve_forever, daemon=True)
    worker.start()

    try:
        url = f"http://127.0.0.1:{server.server_port}/index.html"
        result = subprocess.run(
            [
                browser,
                "--headless=new",
                "--no-sandbox",
                "--disable-gpu",
                "--disable-dev-shm-usage",
                "--no-first-run",
                "--no-default-browser-check",
                "--disable-extensions",
                "--virtual-time-budget=2500",
                "--dump-dom",
                url,
            ],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    finally:
        server.shutdown()
        server.server_close()
        worker.join(timeout=5)

    if result.returncode != 0:
        raise RuntimeError(
            f"Chromium exited with {result.returncode}: {result.stderr[-1000:]}"
        )
    if 'data-csp-test="PASS"' not in result.stdout:
        raise AssertionError(
            "CSP browser check failed: a trusted script or consent hash was "
            "blocked, or unauthorized inline code/eval was allowed. "
            f"HTML tail: {result.stdout[-800:]}"
        )


def main() -> int:
    browser = find_browser()
    with tempfile.TemporaryDirectory(prefix="teacher-csp-pilot-") as root:
        directory = Path(root)
        create_fixture(directory)
        test_browser(browser, directory)
    print("PASS: real browser allows approved scripts and blocks inline/eval injection.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, AssertionError, subprocess.TimeoutExpired) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        raise SystemExit(1) from error
