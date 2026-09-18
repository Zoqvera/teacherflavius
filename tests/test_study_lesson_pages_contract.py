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

    def test_editor_can_create_a_new_roadmap_card(self) -> None:
        editor = self.read("criar-licao/index.html")
        service = self.read("study_lesson_service.js")
        controller = self.read("criar_licao.js")

        self.assertIn('value="0">CRIAR NOVO CARD', editor)
        self.assertIn("NEW_ROADMAP_CARD_SENTINEL", service)
        self.assertIn("EXISTING_ROADMAP_CARD_COUNT", service)
        self.assertIn("CRIAR NOVO CARD", controller)
        self.assertIn("savedPage.roadmap_lesson_number", controller)

    def test_dynamic_card_migration_removes_the_24_card_ceiling(self) -> None:
        migration = self.read("supabase/migrations/20260918190500_enable_dynamic_study_roadmap_cards.sql")

        self.assertIn("drop constraint if exists study_lesson_pages_roadmap_lesson_number_check", migration)
        self.assertIn("check (roadmap_lesson_number >= 1)", migration)
        self.assertIn("drop constraint if exists study_roadmap_completion_lesson_number_check", migration)
        self.assertIn("check (lesson_number >= 1)", migration)
        self.assertIn("new.roadmap_lesson_number = 0", migration)
        self.assertIn("pg_advisory_xact_lock", migration)
        self.assertIn("greatest(", migration)

    def test_roadmap_renders_teacher_created_cards_after_lesson_24(self) -> None:
        roadmap = self.read("roteiro_de_estudos.html")

        self.assertIn("roadmapLessonNumbers", roadmap)
        self.assertIn("createdCards", roadmap)
        self.assertIn("EXISTING_ROADMAP_CARD_COUNT", roadmap)
        self.assertIn("linkedPage.title", roadmap)
        self.assertIn("linkedPage.objective", roadmap)

    def test_final_lesson_page_uses_requested_visual_hierarchy(self) -> None:
        lesson = self.read("licao/index.html")
        styles = self.read("study_lesson_page.css")

        self.assertIn("lesson-objective-text", lesson)
        self.assertIn("lesson-example-card", lesson)
        self.assertIn("lesson-exercise-text", lesson)
        self.assertIn("lesson-vocabulary-card", lesson)

        self.assertIn("text-align: center", styles)
        self.assertIn("font-size: clamp(34px, 5vw, 50px)", styles)
        self.assertIn("font-style: italic", styles)
        self.assertIn(".lesson-example-card", styles)
        self.assertIn("background: rgba(255, 255, 255, 0.10)", styles)
        self.assertIn("text-transform: uppercase", styles)
        self.assertIn("font-weight: 700", styles)
        self.assertIn(".lesson-vocabulary-card", styles)

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
