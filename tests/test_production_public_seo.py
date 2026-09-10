from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_public_seo import transform_public_seo_html, update_public_seo  # noqa: E402


class ProductionPublicSeoTests(unittest.TestCase):
    def test_injects_social_metadata_from_existing_seo_fields(self) -> None:
        html = """<!doctype html>
<html><head>
<title>Guia de inglês | Teacher Flávio</title>
<meta name="description" content="Descrição suficientemente detalhada para representar uma página pública de teste do site.">
<link rel="canonical" href="https://teacherflavius.com/recursos/guia/">
</head><body><h1>Guia</h1></body></html>"""

        result = transform_public_seo_html(html, Path("recursos/guia/index.html"))

        self.assertIn('property="og:type" content="article"', result)
        self.assertIn('property="og:url" content="https://teacherflavius.com/recursos/guia/"', result)
        self.assertIn('name="twitter:card" content="summary_large_image"', result)

    def test_transform_is_idempotent_when_open_graph_already_exists(self) -> None:
        html = """<html><head>
<title>Página | Teacher Flávio</title>
<meta name="description" content="Descrição válida para o teste de idempotência do pós-processamento de SEO.">
<link rel="canonical" href="https://teacherflavius.com/">
<meta property="og:title" content="Página | Teacher Flávio">
</head><body><h1>Página</h1></body></html>"""

        self.assertEqual(transform_public_seo_html(html, Path("index.html")), html)

    def test_updates_every_page_listed_in_sitemap(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            (publish / "recursos").mkdir(parents=True)
            (publish / "sitemap.xml").write_text(
                """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://teacherflavius.com/</loc></url>
  <url><loc>https://teacherflavius.com/recursos/</loc></url>
</urlset>""",
                encoding="utf-8",
            )
            template = """<html><head>
<title>{title}</title>
<meta name="description" content="Descrição de teste com conteúdo suficiente para representar os metadados da página pública.">
<link rel="canonical" href="{canonical}">
</head><body><h1>{title}</h1></body></html>"""
            (publish / "index.html").write_text(
                template.format(title="Home", canonical="https://teacherflavius.com/"),
                encoding="utf-8",
            )
            (publish / "recursos" / "index.html").write_text(
                template.format(title="Recursos", canonical="https://teacherflavius.com/recursos/"),
                encoding="utf-8",
            )

            update_public_seo(publish)

            self.assertIn('property="og:title"', (publish / "index.html").read_text(encoding="utf-8"))
            self.assertIn(
                'property="og:title"',
                (publish / "recursos" / "index.html").read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
