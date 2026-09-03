from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_homepage import transform_homepage_html, update_homepage  # noqa: E402


class ProductionHomepageTests(unittest.TestCase):
    def source_html(self) -> str:
        return '''<section class="section" aria-labelledby="benefits-title">
<h2 id="benefits-title">Inglês online com professor, prática e acompanhamento.</h2>
<p>Conteúdo</p>
</section>'''

    def test_transforms_benefits_section(self) -> None:
        transformed = transform_homepage_html(self.source_html())
        self.assertIn('aria-label="Como funcionam as aulas"', transformed)
        self.assertNotIn('id="benefits-title"', transformed)
        self.assertIn("<p>Conteúdo</p>", transformed)

    def test_transformation_is_idempotent(self) -> None:
        first = transform_homepage_html(self.source_html())
        second = transform_homepage_html(first)
        self.assertEqual(second, first)

    def test_update_requires_homepage_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SystemExit):
                update_homepage(Path(directory))


if __name__ == "__main__":
    unittest.main()
