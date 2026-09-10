from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_build_pipeline import HtmlTransformStats  # noqa: E402
from static_build_summary import format_build_summary  # noqa: E402


class StaticBuildSummaryTests(unittest.TestCase):
    def test_formats_publish_summary(self) -> None:
        summary = format_build_summary(
            42,
            HtmlTransformStats(enhanced_files=7, dependency_injections=11),
            5,
        )

        self.assertEqual(
            summary,
            "Static publish directory ready: 42 public files + _headers; "
            "site baseline enhanced 7 HTML files; "
            "injected 11 dependency scripts; "
            "materialized 5 clean route aliases",
        )


if __name__ == "__main__":
    unittest.main()
