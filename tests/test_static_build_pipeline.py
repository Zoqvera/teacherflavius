from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_build_pipeline import HtmlTransformStats, transform_copied_html  # noqa: E402


class StaticBuildPipelineTests(unittest.TestCase):
    def test_returns_zero_stats_without_html_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            (publish / "app.js").write_text("console.log('ok')", encoding="utf-8")

            stats = transform_copied_html(publish, [Path("app.js")])

            self.assertEqual(stats, HtmlTransformStats())

    def test_transforms_html_and_aggregates_stats(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            first = publish / "index.html"
            second = publish / "page.htm"
            first.write_text("<html>one</html>", encoding="utf-8")
            second.write_text("<html>two</html>", encoding="utf-8")

            results = [
                ("<html>ONE</html>", 2, True),
                ("<html>two</html>", 1, False),
            ]
            with patch("static_build_pipeline.transform_html", side_effect=results) as transform:
                stats = transform_copied_html(
                    publish,
                    [Path("index.html"), Path("page.htm")],
                )

            self.assertEqual(transform.call_count, 2)
            self.assertEqual(first.read_text(encoding="utf-8"), "<html>ONE</html>")
            self.assertEqual(second.read_text(encoding="utf-8"), "<html>two</html>")
            self.assertEqual(
                stats,
                HtmlTransformStats(enhanced_files=1, dependency_injections=3),
            )

    def test_does_not_rewrite_unchanged_html(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            page = publish / "index.html"
            page.write_text("same", encoding="utf-8")

            with patch("static_build_pipeline.transform_html", return_value=("same", 0, False)):
                with patch.object(Path, "write_text", wraps=Path.write_text) as write_text:
                    transform_copied_html(publish, [Path("index.html")])

            write_text.assert_not_called()


if __name__ == "__main__":
    unittest.main()
