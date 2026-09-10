from __future__ import annotations

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
