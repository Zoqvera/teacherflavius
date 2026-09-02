#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"
GTM_CONTAINER_ID = "GTM-K2NWR2NK"

HEAD_OPEN_RE = re.compile(r"<head(?:\s[^>]*)?>", re.IGNORECASE)
BODY_OPEN_RE = re.compile(r"<body(?:\s[^>]*)?>", re.IGNORECASE)
HTML_OPEN_RE = re.compile(r"<html(?:\s[^>]*)?>", re.IGNORECASE)

GTM_HEAD_MARKER = "<!-- Google Tag Manager -->"
GTM_BODY_MARKER = "<!-- Google Tag Manager (noscript) -->"

GTM_HEAD_SNIPPET = f"""<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){{w[l]=w[l]||[];w[l].push({{'gtm.start':
new Date().getTime(),event:'gtm.js'}});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
}})(window,document,'script','dataLayer','{GTM_CONTAINER_ID}');</script>
<!-- End Google Tag Manager -->"""

GTM_BODY_SNIPPET = f"""<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={GTM_CONTAINER_ID}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->"""


def insert_after_opening_tag(html: str, tag_re: re.Pattern[str], snippet: str) -> str:
    match = tag_re.search(html)
    if not match:
        return html
    return f"{html[:match.end()]}\n{snippet}\n{html[match.end():]}"


def inject_gtm(html: str, relative: Path) -> tuple[str, bool]:
    if not HTML_OPEN_RE.search(html):
        return html, False

    has_head_snippet = GTM_HEAD_MARKER in html
    has_body_snippet = GTM_BODY_MARKER in html
    if has_head_snippet != has_body_snippet:
        raise SystemExit(f"Partial Google Tag Manager installation in {relative.as_posix()}")
    if has_head_snippet:
        return html, False

    if not HEAD_OPEN_RE.search(html) or not BODY_OPEN_RE.search(html):
        raise SystemExit(f"HTML document missing <head> or <body>: {relative.as_posix()}")

    html = insert_after_opening_tag(html, HEAD_OPEN_RE, GTM_HEAD_SNIPPET)
    html = insert_after_opening_tag(html, BODY_OPEN_RE, GTM_BODY_SNIPPET)
    return html, True


def validate_gtm(html: str, relative: Path) -> None:
    if not HTML_OPEN_RE.search(html):
        return

    if html.count(GTM_HEAD_MARKER) != 1 or html.count(GTM_BODY_MARKER) != 1:
        raise SystemExit(f"Invalid Google Tag Manager snippet count in {relative.as_posix()}")
    if html.count(GTM_CONTAINER_ID) != 2:
        raise SystemExit(f"Invalid Google Tag Manager container ID count in {relative.as_posix()}")

    head = HEAD_OPEN_RE.search(html)
    body = BODY_OPEN_RE.search(html)
    if not head or not body:
        raise SystemExit(f"HTML document missing <head> or <body>: {relative.as_posix()}")
    if html.find(GTM_HEAD_MARKER) < head.end():
        raise SystemExit(f"Google Tag Manager head snippet is outside <head> in {relative.as_posix()}")
    if html.find(GTM_BODY_MARKER) < body.end():
        raise SystemExit(f"Google Tag Manager noscript snippet is outside <body> in {relative.as_posix()}")


def main() -> None:
    if not PUBLISH.is_dir():
        raise SystemExit("Run scripts/build_static_site.py before Google Tag Manager injection")

    injected = 0
    documents = 0
    for path in sorted(PUBLISH.rglob("*.html")):
        relative = path.relative_to(PUBLISH)
        html = path.read_text(encoding="utf-8")
        if not HTML_OPEN_RE.search(html):
            continue

        documents += 1
        html, changed = inject_gtm(html, relative)
        validate_gtm(html, relative)
        if changed:
            path.write_text(html, encoding="utf-8")
            injected += 1

    if documents == 0:
        raise SystemExit("No HTML documents found in static publish directory")

    print(
        f"Google Tag Manager {GTM_CONTAINER_ID} validated in {documents} HTML documents; "
        f"injected into {injected} documents"
    )


if __name__ == "__main__":
    main()
