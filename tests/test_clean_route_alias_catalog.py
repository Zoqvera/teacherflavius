from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from clean_route_alias_catalog import ALIASES  # noqa: E402


class CleanRouteAliasCatalogTests(unittest.TestCase):
    def test_mensalidades_alias_contract(self) -> None:
        self.assertEqual(len(ALIASES), 1)
        alias = ALIASES[0]
        self.assertEqual(alias.source, "mensalidades.html")
        self.assertEqual(alias.target, "mensalidades/index.html")
        self.assertEqual(alias.canonical_path, "/mensalidades/")
        self.assertEqual(alias.stylesheet, "/mensalidades/mensalidades_visual.css?v=20260901-1")
        self.assertEqual(alias.script, "/mensalidades/mensalidades_visual.js?v=20260901-1")


if __name__ == "__main__":
    unittest.main()
