from __future__ import annotations

import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PAGE = ROOT / "metodologia-e-conteudo-programatico" / "index.html"
APP = ROOT / "metodologia-e-conteudo-programatico" / "app.mjs"
STYLES = ROOT / "metodologia-e-conteudo-programatico" / "style.css"


class MethodologyPublicPageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.html = PAGE.read_text(encoding="utf-8")
        cls.javascript = APP.read_text(encoding="utf-8")

    def test_preview_remains_noindex_pending_seo_decision(self) -> None:
        self.assertIn('name="robots" content="noindex, follow"', self.html)
        self.assertNotIn('rel="canonical"', self.html)

        sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
        self.assertNotIn("/metodologia-e-conteudo-programatico/", sitemap)

    def test_page_contains_methodology_curriculum_and_responsive_styles(self) -> None:
        for marker in (
            'id="como-funciona"',
            'id="conteudo-programatico"',
            'id="catalogStages"',
            'id="catalogStatus"',
            'id="catalogSearch"',
            'id="catalogHeroCount"',
            '/metodologia-e-conteudo-programatico/app.mjs',
            '/metodologia-e-conteudo-programatico/style.css',
        ):
            self.assertIn(marker, self.html)

        css = STYLES.read_text(encoding="utf-8")
        self.assertIn("@media (max-width: 680px)", css)
        self.assertIn("prefers-reduced-motion", css)

    def test_public_page_avoids_full_study_material_and_forbidden_term(self) -> None:
        self.assertNotRegex(self.html, re.compile(r"\bonline\b", re.IGNORECASE))
        self.assertNotIn("/licao/?id=", self.html)
        self.assertNotIn('name="service_role"', self.html)
        self.assertNotIn("supabase/functions/public-study-catalog/index.ts", self.html)

    def test_client_uses_safe_dom_insertion_and_auto_refresh(self) -> None:
        self.assertIn("loadPublicCatalog", self.javascript)
        self.assertIn("replaceChildren", self.javascript)
        self.assertIn("textContent", self.javascript)
        self.assertIn("window.setInterval(refreshIfNeeded, REFRESH_INTERVAL_MS)", self.javascript)
        self.assertNotIn(".innerHTML", self.javascript)


if __name__ == "__main__":
    unittest.main()
