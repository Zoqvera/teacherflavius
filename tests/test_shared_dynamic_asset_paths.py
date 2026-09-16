from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class SharedDynamicAssetPathTests(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_auth_infrastructure_uses_root_relative_animated_card_assets(self):
        source = self.read("auth_infrastructure.js")
        self.assertIn('animatedCardsCss: "/animated_cards.css', source)
        self.assertIn('animatedCardsJs: "/animated_cards.js', source)
        self.assertIn('script[src^="/animated_cards.js"]', source)
        self.assertIn('link[href^="/animated_cards.css"]', source)

    def test_animated_cards_uses_root_relative_recorded_lessons_script(self):
        source = self.read("animated_cards.js")
        self.assertIn('src: "/class_recorded_lessons.js', source)
        self.assertIn('script[src^="/class_recorded_lessons.js"]', source)

    def test_lesson_template_uses_root_relative_animated_cards_script(self):
        source = self.read("aula_template.js")
        self.assertIn('animationScript.src = "/animated_cards.js', source)
        self.assertIn('script[src^="/animated_cards.js"]', source)


if __name__ == "__main__":
    unittest.main()
