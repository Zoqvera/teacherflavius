#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

GTM_CONTAINER_ID = "GTM-K2NWR2NK"

HEAD_OPEN_RE = re.compile(r"<head(?:\s[^>]*)?>", re.IGNORECASE)
BODY_OPEN_RE = re.compile(r"<body(?:\s[^>]*)?>", re.IGNORECASE)
HTML_OPEN_RE = re.compile(r"<html(?:\s[^>]*)?>", re.IGNORECASE)

CONSENT_MODE_MARKER = "<!-- Google Consent Mode default -->"
GTM_HEAD_MARKER = "<!-- Google Tag Manager -->"
GTM_BODY_MARKER = "<!-- Google Tag Manager (noscript) -->"

CONSENT_MODE_SNIPPET = """<!-- Google Consent Mode default -->
<script>
window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function(){dataLayer.push(arguments);};
gtag('consent', 'default', {
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  wait_for_update: 500
});
</script>
<!-- End Google Consent Mode default -->"""

GTM_HEAD_SNIPPET = f"""{CONSENT_MODE_SNIPPET}
<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){{w[l]=w[l]||[];w[l].push({{'gtm.start':
new Date().getTime(),event:'gtm.js'}});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
}})(window,document,'script','dataLayer','{GTM_CONTAINER_ID}');</script>
<!-- End Google Tag Manager -->"""

GTM_BODY_SNIPPET = f"""<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id={GTM_CONTAINER_ID}"
title="Google Tag Manager" aria-hidden="true"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->"""


def insert_after_opening_tag(html: str, tag_re: re.Pattern[str], snippet: str) -> str:
    match = tag_re.search(html)
    if not match:
        return html
    return f"{html[:match.end()]}\n{snippet}\n{html[match.end():]}"


def insert_before_marker(html: str, marker: str, snippet: str) -> str:
    marker_position = html.find(marker)
    if marker_position < 0:
        return html
    return f"{html[:marker_position]}{snippet}\n{html[marker_position:]}"


def inject_gtm(html: str, relative: Path) -> tuple[str, bool]:
    if not HTML_OPEN_RE.search(html):
        return html, False

    has_consent_snippet = CONSENT_MODE_MARKER in html
    has_head_snippet = GTM_HEAD_MARKER in html
    has_body_snippet = GTM_BODY_MARKER in html

    if has_head_snippet != has_body_snippet:
        raise SystemExit(f"Partial Google Tag Manager installation in {relative.as_posix()}")
    if has_consent_snippet and not has_head_snippet:
        raise SystemExit(f"Google Consent Mode installed without GTM in {relative.as_posix()}")

    if has_head_snippet:
        if has_consent_snippet:
            return html, False
        return insert_before_marker(html, GTM_HEAD_MARKER, CONSENT_MODE_SNIPPET), True

    if not HEAD_OPEN_RE.search(html) or not BODY_OPEN_RE.search(html):
        raise SystemExit(f"HTML document missing <head> or <body>: {relative.as_posix()}")

    transformed = insert_after_opening_tag(html, HEAD_OPEN_RE, GTM_HEAD_SNIPPET)
    transformed = insert_after_opening_tag(transformed, BODY_OPEN_RE, GTM_BODY_SNIPPET)
    return transformed, True


def validate_gtm(html: str, relative: Path) -> None:
    if not HTML_OPEN_RE.search(html):
        return

    if html.count(CONSENT_MODE_MARKER) != 1:
        raise SystemExit(f"Invalid Google Consent Mode snippet count in {relative.as_posix()}")
    if html.count(GTM_HEAD_MARKER) != 1 or html.count(GTM_BODY_MARKER) != 1:
        raise SystemExit(f"Invalid Google Tag Manager snippet count in {relative.as_posix()}")
    if html.count(GTM_CONTAINER_ID) != 2:
        raise SystemExit(f"Invalid Google Tag Manager container ID count in {relative.as_posix()}")

    head = HEAD_OPEN_RE.search(html)
    body = BODY_OPEN_RE.search(html)
    if not head or not body:
        raise SystemExit(f"HTML document missing <head> or <body>: {relative.as_posix()}")

    consent_position = html.find(CONSENT_MODE_MARKER)
    gtm_head_position = html.find(GTM_HEAD_MARKER)
    if consent_position < head.end():
        raise SystemExit(f"Google Consent Mode snippet is outside <head> in {relative.as_posix()}")
    if consent_position > gtm_head_position:
        raise SystemExit(f"Google Consent Mode must load before GTM in {relative.as_posix()}")
    if gtm_head_position < head.end():
        raise SystemExit(f"Google Tag Manager head snippet is outside <head> in {relative.as_posix()}")
    if html.find(GTM_BODY_MARKER) < body.end():
        raise SystemExit(f"Google Tag Manager noscript snippet is outside <body> in {relative.as_posix()}")
