from __future__ import annotations

import re
import unittest
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGET = "/metodologia-e-conteudo-programatico/"
GROUP = ROOT / "aulas-em-grupo/index.html"
INDIVIDUAL = ROOT / "aulas-individuais/index.html"
METHODOLOGY = ROOT / "metodologia-e-conteudo-programatico/index.html"
CSS = ROOT / "methodology_funnel_cta.css"


class LinkCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[dict[str, str | None]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "a":
            self.links.append(dict(attrs))


class MethodologyFunnelButtonsTests(unittest.TestCase):
    def read_html(self, page: Path) -> str:
        return page.read_text(encoding="utf-8")

    def test_group_button_sits_after_benefits_and_before_course_introduction(self) -> None:
        html = self.read_html(GROUP)
        self.assertLess(html.index('id="como-funciona"'), html.index('id="group-methodology-cta-title"'))
        self.assertLess(html.index('id="group-methodology-cta-title"'), html.index('id="course-intro-title"'))
        self.assertIn('data-marketing-cta="group_methodology_details"', html)
        self.assertIn("AGENDAR AULA EXPERIMENTAL GRATUITA", html)
        self.assertIn('href="#como-funciona"', html)

    def test_individual_button_sits_after_personalized_content(self) -> None:
        html = self.read_html(INDIVIDUAL)
        self.assertLess(html.index('aria-label="Conteúdo das aulas"'), html.index('id="individual-methodology-cta-title"'))
        self.assertLess(html.index('id="individual-methodology-cta-title"'), html.index('id="course-intro-title"'))
        self.assertIn("o conteúdo pode ser adaptado aos seus objetivos", html)
        self.assertIn('data-marketing-cta="individual_methodology_details"', html)
        self.assertIn("QUERO AULAS INDIVIDUAIS", html)

    def test_exactly_one_semantic_link_on_each_funnel(self) -> None:
        for page in (GROUP, INDIVIDUAL):
            with self.subTest(page=page):
                html = self.read_html(page)
                parser = LinkCollector()
                parser.feed(html)
                matching = [link for link in parser.links if link.get("href") == TARGET]
                self.assertEqual(len(matching), 1)
                self.assertIn("methodology-funnel-cta__button", matching[0].get("class", ""))
                self.assertNotIn("target", matching[0])
                self.assertIn('<svg viewBox="0 0 24 24"', html)
                self.assertIn('href="/methodology_funnel_cta.css?v=20261023-1"', html)

    def test_shared_style_is_responsive_and_accessible(self) -> None:
        stylesheet = CSS.read_text(encoding="utf-8")
        self.assertIn(".methodology-funnel-cta__button:focus-visible", stylesheet)
        self.assertIn("@media (max-width: 760px)", stylesheet)
        self.assertIn("min-height: 50px", stylesheet)
        self.assertIn("prefers-reduced-motion", stylesheet)

    def test_noindex_and_sitemap_decision_remain_unchanged(self) -> None:
        html = self.read_html(METHODOLOGY)
        self.assertIn('name="robots" content="noindex, follow"', html)
        self.assertNotIn('rel="canonical"', html)
        sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
        self.assertNotIn(TARGET, sitemap)

    def test_new_copy_contains_no_forbidden_word(self) -> None:
        for page in (GROUP, INDIVIDUAL):
            html = self.read_html(page)
            label = "group" if page == GROUP else "individual"
            start = html.index('<aside class="methodology-funnel-cta"')
            end = html.index("</aside>", start)
            text = html[start:end]
            self.assertNotRegex(text, re.compile(r"\\bonline\\b", re.IGNORECASE))


if __name__ == "__main__":
    unittest.main()
