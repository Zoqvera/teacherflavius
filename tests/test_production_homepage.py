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
        return '''<style>
.video-trigger{background:linear-gradient(rgba(1,9,24,.18),rgba(1,9,24,.52)),url('/assets/home-free-class-thumbnail.jpg?v=20260908-1') center/cover no-repeat}
.video-trigger:hover{background:linear-gradient(rgba(1,9,24,.08),rgba(1,9,24,.4)),url('/assets/home-free-class-thumbnail.jpg?v=20260908-1') center/cover no-repeat}
</style>
<section class="section" aria-labelledby="benefits-title">
<h2 id="benefits-title">Inglês online com professor, prática e acompanhamento.</h2>
<p>Conteúdo</p>
</section>
<div class="video-frame" id="homeVideoFrame">
<button class="video-trigger" id="homeVideoTrigger" type="button" aria-label="Reproduzir aula gratuita do Teacher Flávio">
<span class="video-play" aria-hidden="true">▶</span>
</button>
</div>'''

    def test_transforms_benefits_section(self) -> None:
        transformed = transform_homepage_html(self.source_html())
        self.assertIn('aria-label="Como funcionam as aulas"', transformed)
        self.assertNotIn('id="benefits-title"', transformed)
        self.assertIn("<p>Conteúdo</p>", transformed)

    def test_moves_video_thumbnail_from_eager_css_to_lazy_image(self) -> None:
        transformed = transform_homepage_html(self.source_html())
        self.assertNotIn("url('/assets/home-free-class-thumbnail.jpg", transformed)
        self.assertIn('class="video-trigger-image"', transformed)
        self.assertIn('loading="lazy"', transformed)
        self.assertIn('decoding="async"', transformed)
        self.assertIn(".video-trigger:hover .video-trigger-image", transformed)

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
