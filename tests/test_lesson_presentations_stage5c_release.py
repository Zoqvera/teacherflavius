"""Production-audited release contract for lesson presentation UI."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


class PresentationStage5CReleaseTests(unittest.TestCase):
    def test_both_release_gates_are_synchronized_and_source_only(self) -> None:
        for path in ("lesson_presentation_editor.js", "teacher_lesson_presentations.js"):
            source = read(path)
            self.assertIn("const RELEASE_ENABLED = true;", source)
            self.assertNotIn("const RELEASE_ENABLED = false;", source)
            for unsafe in ("localStorage", "sessionStorage", "URLSearchParams", "location.search"):
                self.assertNotIn(unsafe, source)

    def test_private_pages_load_updated_scripts_and_stay_nonindexable(self) -> None:
        student = read("licao/index.html")
        teacher = read("roteiro-da-aula/index.html")
        self.assertIn("lesson_presentation_editor.js?v=20261017-stage5c-1", student)
        self.assertIn("teacher_lesson_presentations.js?v=20261020-always-visible-1", teacher)
        self.assertIn('<meta name="robots" content="noindex,nofollow">', student)
        self.assertIn('<meta name="robots" content="noindex, nofollow">', teacher)

    def test_original_immutable_versions_and_receipt_permissions_remain(self) -> None:
        current = read("supabase/migrations/20261017133000_lesson_presentations_stage1.sql")
        views = read("supabase/migrations/20261017144500_lesson_presentation_views_stage3.sql")
        self.assertIn("alter table public.lesson_presentations enable row level security", current)
        self.assertIn("alter table public.lesson_presentation_versions enable row level security", current)
        self.assertIn("create trigger record_lesson_presentation_version", current)
        self.assertIn("grant select on public.lesson_presentation_versions to authenticated", current)
        self.assertIn("grant insert (presentation_id, revision_number, teacher_id)", views)
        self.assertIn("teacher_id = (select auth.uid())", views)
        self.assertIn("and (select public.is_teacher_admin())", views)

    def test_original_manual_database_rollout_is_unchanged(self) -> None:
        workflow = read(".github/workflows/lesson-presentations-stage5b-production.yml")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertNotIn("  push:", workflow)
        self.assertIn("CONFIRMO_APRESENTACOES_5B", workflow)

    def test_ci_contracts_demand_activated_state(self) -> None:
        for path in (
            ".github/workflows/lesson-presentations-stage2-contract.yml",
            ".github/workflows/lesson-presentations-stage3-contract.yml",
            ".github/workflows/lesson-presentations-stage4-integration.yml",
        ):
            workflow = read(path)
            self.assertIn("const RELEASE_ENABLED = true;", workflow)
            self.assertNotIn("const RELEASE_ENABLED = false;", workflow)


if __name__ == "__main__":
    unittest.main()
