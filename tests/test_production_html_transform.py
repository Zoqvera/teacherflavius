from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_html_transform import apply_html_transform  # noqa: E402


class ProductionHtmlTransformTests(unittest.TestCase):
    def test_applies_transform_to_target_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            target = publish / "nested" / "index.html"
            target.parent.mkdir(parents=True)
            target.write_text("before", encoding="utf-8")

            apply_html_transform(
                publish,
                Path("nested/index.html"),
                lambda html: html.replace("before", "after"),
                missing_message="missing",
            )

            self.assertEqual(target.read_text(encoding="utf-8"), "after")

    def test_preserves_file_when_transform_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            target = publish / "index.html"
            target.write_text("same", encoding="utf-8")

            apply_html_transform(
                publish,
                Path("index.html"),
                lambda html: html,
                missing_message="missing",
            )

            self.assertEqual(target.read_text(encoding="utf-8"), "same")

    def test_uses_caller_missing_message(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(SystemExit, "expected missing message"):
                apply_html_transform(
                    Path(directory),
                    Path("index.html"),
                    lambda html: html,
                    missing_message="expected missing message",
                )


if __name__ == "__main__":
    unittest.main()
