from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class PublicMethodologySamplesTests(unittest.TestCase):
    def test_public_section_exists(self):
        page = (ROOT / "metodologia-e-conteudo-programatico/index.html").read_text()
        for marker in ["methodologySampleLessons", "methodologySampleQuestions", "methodologyAnswers"]:
            self.assertIn(marker, page)
        self.assertIn('name="robots" content="noindex, follow"', page)

    def test_safe_rendering(self):
        source = (ROOT / "metodologia-e-conteudo-programatico/samples_app.mjs").read_text()
        self.assertIn("textContent", source)
        self.assertNotIn("innerHTML", source)
        self.assertIn("aria-expanded", source)

if __name__ == "__main__":
    unittest.main()
