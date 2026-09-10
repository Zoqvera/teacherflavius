from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_html_baseline import inject_site_baseline  # noqa: E402


class StaticHtmlBaselineTests(unittest.TestCase):
    def test_returns_unchanged_html_without_head(self) -> None:
        html = "<html><body>content</body></html>"
        self.assertEqual(inject_site_baseline(html, Path("index.html")), (html, False))

    def test_injects_missing_baseline_resources(self) -> None:
        html = "<html><head><title>Test</title></head><body></body></html>"
        transformed, enhanced = inject_site_baseline(html, Path("index.html"))

        self.assertTrue(enhanced)
        self.assertEqual(transformed.count('name="viewport"'), 1)
        self.assertEqual(transformed.count("/responsive_compat.css"), 1)
        self.assertEqual(transformed.count("/error_monitor.js"), 1)
        self.assertNotIn('data-page-status="404"', transformed)

    def test_is_idempotent(self) -> None:
        html = "<html><head></head><body></body></html>"
        first, first_enhanced = inject_site_baseline(html, Path("index.html"))
        second, second_enhanced = inject_site_baseline(first, Path("index.html"))

        self.assertTrue(first_enhanced)
        self.assertFalse(second_enhanced)
        self.assertEqual(second, first)

    def test_marks_error_monitor_on_404(self) -> None:
        html = "<html><head></head><body></body></html>"
        transformed, _ = inject_site_baseline(html, Path("404.html"))
        self.assertIn('data-page-status="404"', transformed)


if __name__ == "__main__":
    unittest.main()
