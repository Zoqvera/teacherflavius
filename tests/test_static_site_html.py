from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_dependency_runtime import validate_html_dependencies  # noqa: E402
from static_site_dependencies import (  # noqa: E402
    ANALYTICS_DEPENDENCIES,
    AUTH_DEPENDENCIES,
    PORTAL_HELPER_DEPENDENCIES,
)
from static_site_html import transform_html  # noqa: E402
from static_whatsapp_links import STANDARD_WHATSAPP_URL  # noqa: E402


class StaticSiteHtmlTests(unittest.TestCase):
    def base_html(self) -> str:
        return """<html>
<head>
  <title>Test</title>
</head>
<body>
  <a href="https://api.whatsapp.com/send?phone=5534998349756&text=old">WhatsApp</a>
  <script src="/auth.js?v=test"></script>
  <script src="/analytics.js?v=test"></script>
  <script src="/site_footer.js?v=test"></script>
</body>
</html>
"""

    def all_dependencies(self):
        return AUTH_DEPENDENCIES + ANALYTICS_DEPENDENCIES + PORTAL_HELPER_DEPENDENCIES

    def test_injects_dependencies_before_targets_and_standardizes_whatsapp(self) -> None:
        transformed, injections, enhanced = transform_html(self.base_html(), Path("index.html"))

        self.assertEqual(injections, 9)
        self.assertTrue(enhanced)
        self.assertIn(STANDARD_WHATSAPP_URL, transformed)
        self.assertNotIn("api.whatsapp.com", transformed)

        for dependency in AUTH_DEPENDENCIES:
            self.assertLess(
                transformed.index(dependency.dependency_src),
                transformed.index("/auth.js?v=test"),
            )
        for dependency in ANALYTICS_DEPENDENCIES:
            self.assertLess(
                transformed.index(dependency.dependency_src),
                transformed.index("/analytics.js?v=test"),
            )
        for dependency in PORTAL_HELPER_DEPENDENCIES:
            self.assertLess(
                transformed.index(dependency.dependency_src),
                transformed.index("/site_footer.js?v=test"),
            )

    def test_transform_is_idempotent(self) -> None:
        first, first_injections, first_enhanced = transform_html(self.base_html(), Path("index.html"))
        second, second_injections, second_enhanced = transform_html(first, Path("index.html"))

        self.assertEqual(first_injections, 9)
        self.assertTrue(first_enhanced)
        self.assertEqual(second_injections, 0)
        self.assertFalse(second_enhanced)
        self.assertEqual(second, first)

    def test_adds_site_baseline_once(self) -> None:
        transformed, _, _ = transform_html(self.base_html(), Path("index.html"))

        self.assertEqual(transformed.count('name="viewport"'), 1)
        self.assertEqual(transformed.count("/responsive_compat.css"), 1)
        self.assertEqual(transformed.count("/error_monitor.js"), 1)
        self.assertNotIn('data-page-status="404"', transformed)

    def test_marks_404_error_monitor(self) -> None:
        transformed, _, _ = transform_html(self.base_html(), Path("404.html"))
        self.assertIn('data-page-status="404"', transformed)

    def test_validation_rejects_missing_dependencies(self) -> None:
        with self.assertRaises(SystemExit):
            validate_html_dependencies(self.base_html(), Path("index.html"))

    def test_validation_accepts_transformed_html(self) -> None:
        transformed, _, _ = transform_html(self.base_html(), Path("index.html"))
        validate_html_dependencies(transformed, Path("index.html"))


if __name__ == "__main__":
    unittest.main()
