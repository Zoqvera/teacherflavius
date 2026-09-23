from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/20260923142610_add_three_makeup_spots.sql"
BASELINE_OVERLAY = ROOT / "supabase/baseline/35_preserve_referenced_auto_makeup_slots.sql"
LEGACY_INSTALLER = ROOT / "supabase_reposicoes_automaticas_30_dias.sql"
BASELINE_WORKFLOW = ROOT / ".github/workflows/validate-supabase-baseline.yml"


def extract_slot_cleanup(sql: str) -> str:
    start = sql.index("delete from public.makeup_class_slots s")
    end = sql.index("get diagnostics deleted_count = row_count;", start)
    return sql[start:end]


class MakeupSlotSyncContractTests(unittest.TestCase):
    def synchronizer_sources(self) -> tuple[Path, ...]:
        return MIGRATION, BASELINE_OVERLAY, LEGACY_INSTALLER

    def test_cleanup_preserves_slots_referenced_by_any_booking(self) -> None:
        for path in self.synchronizer_sources():
            with self.subTest(path=path.relative_to(ROOT)):
                sql = path.read_text(encoding="utf-8")
                cleanup = extract_slot_cleanup(sql)

                self.assertIn("where b.slot_id = s.id", cleanup)
                self.assertNotIn("b.status = 'confirmed'", cleanup)

    def test_synchronizer_respects_class_makeup_slot_switch(self) -> None:
        for path in self.synchronizer_sources():
            with self.subTest(path=path.relative_to(ROOT)):
                sql = path.read_text(encoding="utf-8")
                self.assertIn(
                    "and coalesce(tc.makeup_slots_enabled, true) = true",
                    sql,
                )

    def test_synchronizer_adds_three_makeup_only_spots(self) -> None:
        expected_formula = "then (5 - sc.student_count) + 3"
        for path in self.synchronizer_sources():
            with self.subTest(path=path.relative_to(ROOT)):
                sql = path.read_text(encoding="utf-8")
                self.assertIn(expected_formula, sql)
                self.assertNotIn("private.get_class_operational_capacity", sql)

    def test_current_migration_updates_future_auto_slots_idempotently(self) -> None:
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("update public.makeup_class_slots s", sql)
        self.assertIn("s.is_auto_generated = true", sql)
        self.assertIn("s.starts_at > now()", sql)
        self.assertIn("s.capacity is distinct from d.capacity", sql)

    def test_disaster_recovery_applies_integrity_overlay(self) -> None:
        workflow = BASELINE_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn(
            "supabase/baseline/35_preserve_referenced_auto_makeup_slots.sql",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
