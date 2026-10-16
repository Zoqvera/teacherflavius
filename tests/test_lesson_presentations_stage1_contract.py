from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20261016224500_lesson_presentations_stage1.sql"


class LessonPresentationsStage1ContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_student_and_lesson_have_a_unique_identity(self) -> None:
        self.assertIn("student_id uuid not null references public.profiles(id)", self.sql)
        self.assertIn("lesson_page_id uuid references public.study_lesson_pages(id)", self.sql)
        self.assertIn("lesson_number integer check (lesson_number > 0)", self.sql)
        self.assertIn("lesson_key text generated always as", self.sql)
        self.assertIn("unique (student_id, lesson_key)", self.sql)
        self.assertIn("create index lesson_presentations_page_idx", self.sql)
        self.assertIn("on public.lesson_presentations (lesson_page_id)", self.sql)
        self.assertIn("(lesson_number is not null) <> (lesson_page_id is not null)", self.sql)

    def test_body_has_length_guard_and_revision_counter(self) -> None:
        self.assertIn("char_length(btrim(body)) between 1 and 15000", self.sql)
        self.assertIn("revision_number integer not null default 1", self.sql)
        self.assertIn("new.revision_number := old.revision_number + 1", self.sql)
        self.assertIn("new.updated_at := now()", self.sql)

    def test_history_is_automatically_recorded_and_read_only(self) -> None:
        self.assertIn("create table public.lesson_presentation_versions", self.sql)
        self.assertIn("unique (presentation_id, revision_number)", self.sql)
        self.assertIn("create trigger record_lesson_presentation_version", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertIn(
            "revoke all on function private.record_lesson_presentation_version() from public, anon, authenticated",
            self.sql,
        )
        self.assertIn("grant select on public.lesson_presentation_versions to authenticated", self.sql)
        self.assertNotIn("grant insert on public.lesson_presentation_versions", self.sql)
        self.assertNotIn("grant update on public.lesson_presentation_versions", self.sql)
        self.assertNotIn("grant delete on public.lesson_presentation_versions", self.sql)

    def test_rls_limits_student_writes_and_teacher_can_read(self) -> None:
        self.assertIn("alter table public.lesson_presentations enable row level security", self.sql)
        self.assertIn("alter table public.lesson_presentation_versions enable row level security", self.sql)
        self.assertIn("student_id = (select auth.uid())", self.sql)
        self.assertIn("(select public.is_teacher_admin())", self.sql)
        self.assertIn("with check (student_id = (select auth.uid()))", self.sql)
        self.assertNotIn("grant delete on public.lesson_presentations", self.sql)
        self.assertIn("somente o texto da apresentacao pode ser editado", self.sql)

    def test_browser_has_no_anonymous_access(self) -> None:
        self.assertIn("revoke all on table public.lesson_presentations from anon, authenticated", self.sql)
        self.assertIn("revoke all on table public.lesson_presentation_versions from anon, authenticated", self.sql)
        self.assertNotIn("to anon", self.sql)


if __name__ == "__main__":
    unittest.main()
