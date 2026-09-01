#!/usr/bin/env python3
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"
RESPONSIVE_COMPAT_HREF = "/responsive_compat.css?v=20260820-1"
RESPONSIVE_COMPAT_LINK = f'  <link rel="stylesheet" href="{RESPONSIVE_COMPAT_HREF}">'
ERROR_MONITOR_SRC = "/error_monitor.js?v=20260820-1"
VIEWPORT_META = '  <meta name="viewport" content="width=device-width, initial-scale=1.0">'
CLEAN_ROUTE_LOADER = ROOT / "clean_route_loader.js"
STANDARD_WHATSAPP_URL = "https://wa.me/5534998349756?text=Ol%C3%A1%2C%20Teacher%21%20Vim%20pelo%20site%20e%20gostaria%20de%20conversar%20sobre%20as%20aulas%20de%20ingl%C3%AAs."
WA_ME_RE = re.compile(r'https://wa\.me/5534998349756(?:\?[^"\']*)?', re.IGNORECASE)
API_WHATSAPP_RE = re.compile(r'https://api\.whatsapp\.com/send\?[^"\']*phone=5534998349756[^"\']*', re.IGNORECASE)
CLEAN_ROUTE_PAIR_RE = re.compile(
    r'^\s*"(?P<route>/[^"]+/)"\s*:\s*"(?P<source>/[^"]+\.html)"\s*,?\s*$',
    re.MULTILINE,
)

BLOCKED_TOP_LEVEL = {
    ".git",
    ".github",
    ".netlify",
    "_site",
    "docs",
    "netlify",
    "scripts",
    "supabase",
    "tests",
}

SKIP_NAMES = {"CNAME", ".nojekyll"}

PUBLIC_SUFFIXES = {
    ".html", ".htm",
    ".css", ".js", ".mjs", ".json", ".xml", ".txt",
    ".ico", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif",
    ".pdf",
    ".mp3", ".wav", ".ogg", ".m4a",
    ".mp4", ".webm",
    ".woff", ".woff2", ".ttf", ".otf",
}


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "-z"],
        cwd=ROOT,
        check=True,
        capture_output=True,
    )
    return [Path(raw.decode("utf-8")) for raw in result.stdout.split(b"\0") if raw]


def is_public(path: Path) -> bool:
    if not path.parts:
        return False
    if path.parts[0] in BLOCKED_TOP_LEVEL:
        return False
    if path.name in SKIP_NAMES:
        return False
    if any(part.startswith(".") for part in path.parts):
        return False
    return path.suffix.lower() in PUBLIC_SUFFIXES


def standardize_whatsapp_links(html: str) -> str:
    html = WA_ME_RE.sub(STANDARD_WHATSAPP_URL, html)
    return API_WHATSAPP_RE.sub(STANDARD_WHATSAPP_URL, html)


def inject_site_baseline(html: str, relative: Path) -> tuple[str, bool]:
    closing_head = html.lower().find("</head>")
    if closing_head < 0:
        return html, False

    additions: list[str] = []
    lower_html = html.lower()
    if 'name="viewport"' not in lower_html and "name='viewport'" not in lower_html:
        additions.append(VIEWPORT_META)
    if "/responsive_compat.css" not in lower_html:
        additions.append(RESPONSIVE_COMPAT_LINK)
    if "/error_monitor.js" not in lower_html:
        status_attribute = ' data-page-status="404"' if relative.as_posix() == "404.html" else ""
        additions.append(f'  <script defer src="{ERROR_MONITOR_SRC}"{status_attribute}></script>')

    if not additions:
        return html, False

    prefix = html[:closing_head]
    suffix = html[closing_head:]
    separator = "" if prefix.endswith("\n") else "\n"
    injected = "\n".join(additions)
    return f"{prefix}{separator}{injected}\n{suffix}", True


def ensure_root_base(html: str) -> str:
    if re.search(r"<base\s", html, re.IGNORECASE):
        return html
    head = re.search(r"<head(?:\s[^>]*)?>", html, re.IGNORECASE)
    if not head:
        return html
    return f'{html[:head.end()]}\n  <base href="/">{html[head.end():]}'


def materialize_clean_route_aliases() -> int:
    if not CLEAN_ROUTE_LOADER.is_file():
        raise SystemExit("Missing clean_route_loader.js used to build clean route aliases")

    loader = CLEAN_ROUTE_LOADER.read_text(encoding="utf-8")
    pairs = list(CLEAN_ROUTE_PAIR_RE.finditer(loader))
    if not pairs:
        raise SystemExit("No clean route aliases found in clean_route_loader.js")

    created = 0
    for match in pairs:
        route = match.group("route")
        source_relative = Path(match.group("source").lstrip("/"))
        target_relative = Path(route.strip("/")) / "index.html"

        if source_relative == target_relative:
            continue

        source = PUBLISH / source_relative
        target = PUBLISH / target_relative
        if not source.is_file():
            raise SystemExit(
                f"Clean route source is missing: {source_relative.as_posix()} for {route}"
            )
        if target.is_file():
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        html = source.read_text(encoding="utf-8")
        target.write_text(ensure_root_base(html), encoding="utf-8")
        created += 1

    return created


def main() -> None:
    if PUBLISH.exists():
        shutil.rmtree(PUBLISH)
    PUBLISH.mkdir(parents=True)

    copied = 0
    enhanced_html = 0
    for relative in tracked_files():
        if not is_public(relative):
            continue
        source = ROOT / relative
        if not source.is_file():
            continue
        destination = PUBLISH / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        copied += 1

        if relative.suffix.lower() in {".html", ".htm"}:
            html = destination.read_text(encoding="utf-8")
            original_html = html
            html = standardize_whatsapp_links(html)
            html, enhanced = inject_site_baseline(html, relative)
            if html != original_html:
                destination.write_text(html, encoding="utf-8")
            if enhanced:
                enhanced_html += 1

    clean_route_aliases = materialize_clean_route_aliases()

    headers = ROOT / "netlify" / "_headers"
    if not headers.is_file():
        raise SystemExit("Missing shared hosting headers at netlify/_headers")
    shutil.copy2(headers, PUBLISH / "_headers")

    required = [
        PUBLISH / "index.html",
        PUBLISH / "404.html",
        PUBLISH / "robots.txt",
        PUBLISH / "sitemap.xml",
        PUBLISH / "error_monitor.js",
        PUBLISH / "quero-conhecer" / "index.html",
        PUBLISH / "cadastro" / "index.html",
        PUBLISH / "meu-progresso" / "index.html",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required if not path.is_file()]
    if missing:
        raise SystemExit(f"Static build missing required public files: {', '.join(missing)}")

    compat_stylesheet = PUBLISH / "responsive_compat.css"
    if not compat_stylesheet.is_file():
        raise SystemExit("Static build missing responsive_compat.css")

    forbidden_suffixes = {".md", ".sql", ".py", ".yml", ".yaml", ".toml"}
    leaked = [
        str(path.relative_to(PUBLISH))
        for path in PUBLISH.rglob("*")
        if path.is_file() and path.suffix.lower() in forbidden_suffixes
    ]
    if leaked:
        raise SystemExit(f"Operational files leaked into publish directory: {', '.join(leaked)}")

    print(
        f"Static publish directory ready: {copied} public files + _headers; "
        f"site baseline enhanced {enhanced_html} HTML files; "
        f"materialized {clean_route_aliases} clean route aliases"
    )


if __name__ == "__main__":
    main()
