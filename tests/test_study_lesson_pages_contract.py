from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class StudyLessonPagesContractTests(unittest.TestCase):
    def read(self, relative_path: str) -> str:
        return (ROOT / relative_path).read_text(encoding="utf-8")

    def test_professor_area_exposes_lesson_creator(self) -> None:
        professor = self.read("professor.html")
        self.assertIn('href="/criar-licao/"', professor)
        self.assertIn('data-card-id="criar-licao"', professor)
        self.assertIn("CRIAR LIÇÃO", professor)

    def test_editor_enforces_requested_character_limits(self) -> None:
        editor = self.read("criar-licao/index.html")
        expected_limits = {
            "lessonTitle": 200,
            "lessonObjective": 500,
            "lessonExample": 1000,
            "lessonPracticalExercise": 500,
            "lessonUsefulVocabulary": 1000,
        }

        for field_id, limit in expected_limits.items():
            self.assertIn(f'id="{field_id}"', editor)
            self.assertIn(f'maxlength="{limit}"', editor)

    def test_database_repeats_character_and_link_constraints(self) -> None:
        migration = self.read("supabase/migrations/20260918184911_add_study_lesson_pages.sql")
        for limit in (200, 500, 1000):
            self.assertIn(f"between 1 and {limit}", migration)

        self.assertIn("roadmap_lesson_number between 1 and 24", migration)
        self.assertIn("study_lesson_pages_roadmap_lesson_number_uidx", migration)
        self.assertIn("enable row level security", migration)
        self.assertIn("public.is_teacher_admin_mfa()", migration)

    def test_linking_is_manual_and_optional(self) -> None:
        editor = self.read("criar-licao/index.html")
        migration = self.read("supabase/migrations/20260918184911_add_study_lesson_pages.sql")

        self.assertIn("Não vincular agora", editor)
        self.assertIn("O vínculo é manual", editor)
        self.assertIn("roadmap_lesson_number smallint", migration)
        self.assertNotIn("roadmap_lesson_number smallint not null", migration)

    def test_lesson_page_contains_required_support_cards(self) -> None:
        lesson = self.read("licao/index.html")
        self.assertIn("TRADUTOR", lesson)
        self.assertIn("https://translate.google.com/", lesson)
        self.assertIn("APRENDA A PRONUNCIAR", lesson)
        self.assertIn("https://www.quickpronounce.site/", lesson)

    def test_roadmap_prefers_linked_internal_page(self) -> None:
        roadmap = self.read("roteiro_de_estudos.html")
        self.assertIn("linkedLessonPages", roadmap)
        self.assertIn("StudyLessonService.lessonPageUrl", roadmap)
        self.assertIn("lessonLinks[lessonId]", roadmap)

    def test_new_private_routes_are_not_indexed(self) -> None:
        robots = self.read("robots.txt")
        lesson = self.read("licao/index.html")
        editor = self.read("criar-licao/index.html")

        self.assertIn("Disallow: /licao/", robots)
        self.assertIn("Disallow: /criar-licao/", robots)
        self.assertIn('name="robots" content="noindex,nofollow"', lesson)
        self.assertIn('name="robots" content="noindex,nofollow"', editor)


if __name__ == "__main__":
    unittest.main()
