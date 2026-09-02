#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"


def current_commit_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def update_homepage() -> None:
    index = PUBLISH / "index.html"
    if not index.is_file():
        raise SystemExit("Static build missing _site/index.html")

    html = index.read_text(encoding="utf-8")
    html = re.sub(
        r'<section\s+class="section"\s+aria-labelledby="benefits-title">',
        '<section class="section" aria-label="Como funcionam as aulas">',
        html,
        count=1,
    )
    html = re.sub(
        r'\s*<h2\s+id="benefits-title">Inglês online com professor, prática e acompanhamento\.</h2>\s*',
        "\n",
        html,
        count=1,
    )
    index.write_text(html, encoding="utf-8")


def write_health_check() -> None:
    payload = {
        "status": "ok",
        "service": "teacherflavius.com",
        "commit": current_commit_sha(),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    (PUBLISH / "health.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    if not PUBLISH.is_dir():
        raise SystemExit("Run scripts/build_static_site.py before production post-processing")
    update_homepage()
    write_health_check()
    print("Production post-processing ready: homepage cleanup + health.json")


if __name__ == "__main__":
    main()
