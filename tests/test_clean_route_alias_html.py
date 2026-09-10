from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from clean_route_alias_catalog import ALIASES  # noqa: E402
from clean_route_alias_html import build_alias_html  # noqa: E402


class CleanRouteAliasHtmlTests(unittest.TestCase):
    def test_builds_alias_with_canonical_assets_and_clean_professor_link(self) -> None:
        source = '<html><head></head><body><a href="professor.html">Professor</a></body></html>'
        html = build_alias_html(source, ALIASES[0])
        self.assertIn('<base href="/">', html)
        self.assertIn('href="https://teacherflavius.com/mensalidades/"', html)
        self.assertIn('/mensalidades/mensalidades_visual.css?v=20260901-1', html)
        self.assertIn('/mensalidades/mensalidades_visual.js?v=20260901-1', html)
        self.assertIn('href="/professor/"', html)

    def test_transformation_is_idempotent(self) -> None:
        source = '<html><head></head><body></body></html>'
        first = build_alias_html(source, ALIASES[0])
        second = build_alias_html(first, ALIASES[0])
        self.assertEqual(second, first)


if __name__ == "__main__":
    unittest.main()
