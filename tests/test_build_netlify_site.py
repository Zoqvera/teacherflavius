from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from build_netlify_site import (  # noqa: E402
    NETLIFY_REQUIRED_PUBLIC_PATHS,
    enhance_copied_html,
    validate_netlify_publish,
)
from static_whatsapp_links import STANDARD_WHATSAPP_URL  # noqa: E402


class BuildNetlifySiteTests(unittest.TestCase):
    def test_enhance_copied_html_reuses_shared_transformations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            relative = Path("page.html")
            page = publish / relative
            page.write_text(
                '<html><head><title>Test</title></head><body><a href="https://wa.me/5534998349756?text=old">Chat</a></body></html>',
                encoding="utf-8",
            )

            enhanced = enhance_copied_html(publish, [relative])
            html = page.read_text(encoding="utf-8")

            self.assertEqual(enhanced, 1)
            self.assertIn(STANDARD_WHATSAPP_URL, html)
            self.assertIn("/responsive_compat.css", html)
            self.assertIn("/error_monitor.js", html)

    def test_validate_netlify_publish_accepts_complete_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish = root / "_site"
            for relative in (*NETLIFY_REQUIRED_PUBLIC_PATHS, "responsive_compat.css"):
                path = publish / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("ok", encoding="utf-8")

            validate_netlify_publish(root, publish)

    def test_validate_netlify_publish_reports_missing_files_relative_to_root(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish = root / "_site"
            publish.mkdir()

            with self.assertRaisesRegex(SystemExit, r"_site/index\.html"):
                validate_netlify_publish(root, publish)


if __name__ == "__main__":
    unittest.main()
