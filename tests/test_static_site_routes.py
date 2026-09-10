from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_site_routes import (  # noqa: E402
    CleanRouteAlias,
    ensure_root_base,
    materialize_alias,
    materialize_clean_route_aliases,
    parse_clean_route_aliases,
)


class StaticSiteRoutesTests(unittest.TestCase):
    def test_parses_clean_route_alias(self) -> None:
        loader = '  "/mensalidades/": "/mensalidades.html",\n'
        aliases = parse_clean_route_aliases(loader)
        self.assertEqual(
            aliases,
            (CleanRouteAlias(route="/mensalidades/", source=Path("mensalidades.html"), target=Path("mensalidades/index.html")),),
        )

    def test_ensure_root_base_is_idempotent(self) -> None:
        html = "<html><head><title>x</title></head><body></body></html>"
        updated = ensure_root_base(html)
        self.assertIn('<base href="/">', updated)
        self.assertEqual(ensure_root_base(updated), updated)

    def test_materializes_alias_from_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            source = publish / "page.html"
            source.write_text("<html><head></head><body>ok</body></html>", encoding="utf-8")
            alias = CleanRouteAlias(route="/page/", source=Path("page.html"), target=Path("page/index.html"))

            self.assertTrue(materialize_alias(publish, alias))
            generated = publish / "page" / "index.html"
            self.assertTrue(generated.is_file())
            self.assertIn('<base href="/">', generated.read_text(encoding="utf-8"))
            self.assertFalse(materialize_alias(publish, alias))

    def test_rejects_missing_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            alias = CleanRouteAlias(route="/missing/", source=Path("missing.html"), target=Path("missing/index.html"))
            with self.assertRaisesRegex(SystemExit, "Clean route source is missing"):
                materialize_alias(publish, alias)

    def test_materializes_routes_from_loader_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish = root / "_site"
            publish.mkdir()
            (root / "clean_route_loader.js").write_text('  "/page/": "/page.html",\n', encoding="utf-8")
            (publish / "page.html").write_text("<html><head></head><body></body></html>", encoding="utf-8")

            self.assertEqual(materialize_clean_route_aliases(root, publish), 1)
            self.assertTrue((publish / "page" / "index.html").is_file())


if __name__ == "__main__":
    unittest.main()
