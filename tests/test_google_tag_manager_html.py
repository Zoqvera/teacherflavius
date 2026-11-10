from __future__ import annotations

import base64
import hashlib
import re
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from google_tag_manager_html import (  # noqa: E402
    CONSENT_MODE_MARKER,
    GTM_BODY_MARKER,
    GTM_CONTAINER_ID,
    GTM_HEAD_MARKER,
    GTM_HEAD_SNIPPET,
    inject_gtm,
    validate_gtm,
)


class GoogleTagManagerHtmlTests(unittest.TestCase):
    def test_injects_complete_gtm_installation(self) -> None:
        relative = Path("index.html")
        html = "<html><head><title>Test</title></head><body>Content</body></html>"

        transformed, changed = inject_gtm(html, relative)

        self.assertTrue(changed)
        self.assertEqual(transformed.count(CONSENT_MODE_MARKER), 1)
        self.assertEqual(transformed.count(GTM_HEAD_MARKER), 1)
        self.assertEqual(transformed.count(GTM_BODY_MARKER), 1)
        self.assertEqual(transformed.count(GTM_CONTAINER_ID), 2)
        validate_gtm(transformed, relative)

    def test_preserves_enforced_csp_before_tracking_bootstrap(self) -> None:
        relative = Path("matricula80/index.html")
        policy = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\'">'
        html = f"<html><head>{policy}</head><body></body></html>"

        transformed, changed = inject_gtm(html, relative)

        self.assertTrue(changed)
        self.assertLess(transformed.index(policy), transformed.index(CONSENT_MODE_MARKER))
        self.assertLess(transformed.index(policy), transformed.index(GTM_HEAD_MARKER))
        validate_gtm(transformed, relative)

    def test_promo_policy_hashes_match_materialized_tracking_scripts(self) -> None:
        root = SCRIPTS.parent
        relative = Path("matricula80/index.html")
        original = (root / relative).read_text(encoding="utf-8")
        materialized, _ = inject_gtm(original, relative)

        policy_meta = re.search(
            r'<meta\\s+http-equiv="Content-Security-Policy"\\s+content="([^"]+)"',
            materialized,
        )
        self.assertIsNotNone(policy_meta)
        policy = policy_meta.group(1)
        self.assertIn("script-src 'self'", policy)
        self.assertNotIn("'unsafe-inline'", policy)
        self.assertNotIn("'unsafe-eval'", policy)

        script_blocks = re.findall(
            r"<script(?:\\s[^>]*)?>([\\s\\S]*?)</script>",
            GTM_HEAD_SNIPPET,
        )
        self.assertEqual(len(script_blocks), 2)
        for code in script_blocks:
            digest = hashlib.sha256(code.encode("utf-8")).digest()
            encoded = base64.b64encode(digest).decode("ascii")
            self.assertIn(f"'sha256-{encoded}'", policy)

        self.assertLess(
            materialized.index('http-equiv="Content-Security-Policy"'),
            materialized.index(CONSENT_MODE_MARKER),
        )
        validate_gtm(materialized, relative)

    def test_is_idempotent_for_complete_installation(self) -> None:
        relative = Path("index.html")
        html = "<html><head></head><body></body></html>"
        installed, _ = inject_gtm(html, relative)

        transformed, changed = inject_gtm(installed, relative)

        self.assertFalse(changed)
        self.assertEqual(transformed, installed)

    def test_rejects_partial_gtm_installation(self) -> None:
        html = f"<html><head>{GTM_HEAD_MARKER}</head><body></body></html>"

        with self.assertRaisesRegex(SystemExit, "Partial Google Tag Manager installation"):
            inject_gtm(html, Path("partial.html"))

    def test_ignores_non_html_document_content(self) -> None:
        content = "plain text"

        transformed, changed = inject_gtm(content, Path("notes.html"))

        self.assertFalse(changed)
        self.assertEqual(transformed, content)


if __name__ == "__main__":
    unittest.main()
