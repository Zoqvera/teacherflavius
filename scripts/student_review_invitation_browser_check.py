#!/usr/bin/env python3
"""Run isolated, real-browser acceptance tests for the student review invitation."""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlencode

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD = ROOT / "area_do_estudante.html"
CSS = ROOT / "student_review_invitation.css"
SCRIPT = ROOT / "student_review_invitation.js"
MODAL_PATTERN = re.compile(
    r'<dialog id="studentReviewInvitation"[\s\S]*?</dialog>'
)

SCENARIOS = (
    ("eligible", 320, 740),
    ("eligible", 390, 844),
    ("eligible", 1280, 900),
    ("submitted", 390, 844),
    ("approved", 390, 844),
    ("rejected", 390, 844),
    ("recent", 390, 844),
    ("archived", 390, 844),
    ("professor", 390, 844),
    ("snoozed", 390, 844),
    ("dismiss", 390, 844),
)

FIXTURE_SCRIPT = r"""
(function () {
  "use strict";

  const scenario = new URLSearchParams(location.search).get("scenario");
  const enrolledAt = scenario === "recent"
    ? "2026-09-15T10:00:00-03:00"
    : "2026-08-15T10:00:00-03:00";
  const profile = {
    enrolled: true,
    archived: scenario === "archived",
    enrolled_at: enrolledAt,
    created_at: "2026-07-01T10:00:00-03:00"
  };
  const review = ["submitted", "approved", "rejected"].includes(scenario)
    ? { status: scenario === "submitted" ? "pending" : scenario }
    : null;
  const reviewCalls = [];
  const trackedEvents = [];
  const storageEntries = new Map();
  const key = "teacherflavius:student-review-invitation:synthetic-student";
  if (scenario === "snoozed") {
    storageEntries.set(key, String(Date.parse("2026-10-14T15:00:00-03:00")));
  }
  const storage = {
    getItem(name) { return storageEntries.get(name) || null; },
    setItem(name, value) { storageEntries.set(name, value); }
  };
  const client = {
    from(table) {
      if (table !== "profiles") throw new Error("Incorrect table");
      return {
        select() {
          return {
            eq(field, value) {
              if (field !== "id" || value !== "synthetic-student") {
                throw new Error("Incorrect profile lookup");
              }
              return { maybeSingle: async () => ({ data: profile, error: null }) };
            }
          };
        }
      };
    },
    async rpc(name, params) {
      if (name === "record_my_student_review_invitation") {
        trackedEvents.push(params.target_action);
        return { data: true, error: null };
      }
      if (name !== "get_my_student_review") {
        throw new Error("Incorrect review RPC");
      }
      reviewCalls.push(name);
      return { data: { review }, error: null };
    }
  };

  const dialog = document.getElementById("studentReviewInvitation");
  const shouldShow = ["eligible", "dismiss"].includes(scenario);
  const expectedCalls = ["recent", "archived", "professor"].includes(scenario) ? 0 : 1;

  function report(ok, message) {
    document.body.setAttribute("data-qa-result", ok ? "PASS" : "FAIL");
    document.body.setAttribute("data-qa-detail", message);
  }

  if (!window.StudentReviewInvitation || !dialog) {
    report(false, "Missing production script or dialog");
    return;
  }

  window.StudentReviewInvitation.initialize({
    client,
    studentId: "synthetic-student",
    isProfessor: scenario === "professor",
    dialog,
    storage,
    now: new Date("2026-10-15T16:00:00-03:00")
  }).then(async (shown) => {
    const reviewLink = dialog.querySelector("[data-review-invitation-link]");
    const rect = dialog.getBoundingClientRect();
    const fitsViewport = !dialog.open ||
      (rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1);
    const initialOk = shown === shouldShow &&
      dialog.open === shouldShow &&
      reviewCalls.length === expectedCalls &&
      (shouldShow ? trackedEvents.includes("shown") : trackedEvents.length === 0) &&
      !!reviewLink &&
      reviewLink.getAttribute("href") === "/avaliar-aulas/" &&
      fitsViewport;

    if (!initialOk) {
      report(false, "eligibility, link, RPC or dialog layout did not match");
      return;
    }

    if (scenario === "dismiss") {
      const dismiss = dialog.querySelector("[data-review-invitation-close]");
      dismiss.click();
      await new Promise(resolve => setTimeout(resolve, 50));
      if (dialog.open || !storageEntries.has(key) ||
          !trackedEvents.includes("dismissed")) {
        report(false, "Dismissal did not close, snooze and track");
        return;
      }
    }

    report(true, "Production modal and eligibility logic passed");
  }).catch((error) => {
    report(false, String(error));
  });
})();
"""


def locate_browser() -> str:
    for name in ("google-chrome-stable", "google-chrome", "chromium", "chromium-browser"):
        executable = shutil.which(name)
        if executable:
            return executable
    raise RuntimeError("Chrome/Chromium unavailable; real browser test not run.")


def build_fixture(destination: Path) -> None:
    match = MODAL_PATTERN.search(DASHBOARD.read_text(encoding="utf-8"))
    if not match:
        raise RuntimeError("Production dashboard review modal not found.")

    page = (
        '<!doctype html><html lang="pt-BR"><head>'
        '<meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<style>body{margin:0;min-height:100vh;background:#02102b;color:white}</style>'
        f'<link rel="stylesheet" href="{CSS.as_uri()}">'
        '</head><body>'
        + match.group(0)
        + f'<script src="{SCRIPT.as_uri()}"></script>'
        + "<script>"
        + FIXTURE_SCRIPT
        + "</script></body></html>"
    )
    destination.write_text(page, encoding="utf-8")


def verify_scenario(browser: str, fixture: Path, scenario: str, width: int,
                    height: int) -> None:
    url = fixture.as_uri() + "?" + urlencode({"scenario": scenario})
    cmd = [
        browser, "--headless=new", "--no-sandbox", "--disable-gpu",
        "--disable-dev-shm-usage", "--no-first-run",
        "--no-default-browser-check", "--allow-file-access-from-files",
        "--hide-scrollbars", "--force-device-scale-factor=1",
        f"--window-size={width},{height}",
        "--virtual-time-budget=3500", "--dump-dom", url,
    ]
    result = subprocess.run(
        cmd, cwd=ROOT, capture_output=True, text=True,
        timeout=40, check=False
    )
    if result.returncode:
        raise RuntimeError(
            f"Chrome exited {result.returncode}: {scenario} {width}x{height}"
        )
    status = re.search(r'data-qa-result="([^"]+)"', result.stdout)
    if not status or status.group(1) != "PASS":
        detail = re.search(r'data-qa-detail="([^"]+)"', result.stdout)
        raise AssertionError(
            f"Browser failure {scenario} {width}x{height}: "
            f"{detail.group(1) if detail else 'no result'}"
        )
    print(f"PASS {scenario} {width}x{height}")


def main() -> int:
    browser = locate_browser()
    with tempfile.TemporaryDirectory(prefix="tf-review-qa-") as directory:
        fixture = Path(directory) / "index.html"
        build_fixture(fixture)
        for scenario, width, height in SCENARIOS:
            verify_scenario(browser, fixture, scenario, width, height)
    print(f"PASS: {len(SCENARIOS)} isolated real-browser scenarios.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, AssertionError, subprocess.TimeoutExpired) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
