from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "20260916182500_allow_gmail_dot_equivalent_student_links.sql"
BASELINE_OVERLAY = ROOT / "supabase" / "baseline" / "40_allow_gmail_dot_equivalent_student_links.sql"


class GmailDotAccountLinkContractTest(unittest.TestCase):
    def _assert_contract(self, sql: str) -> None:
        self.assertIn("canonical_gmail_email", sql)
        self.assertIn("gmail.com", sql)
        self.assertIn("googlemail.com", sql)
        self.assertIn("replace(lower(split_part", sql)
        self.assertIn("ambiguous_gmail_match", sql)
        self.assertIn("on conflict (google_email) do nothing", sql)
        self.assertIn("O e-mail Google já está associado a outra matrícula.", sql)
        self.assertIn("revoke all on function public.canonical_gmail_email(text) from public, anon, authenticated", sql)
        self.assertIn("grant execute on function public.canonical_gmail_email(text) to service_role", sql)

    def test_migration_preserves_safe_gmail_equivalence_contract(self) -> None:
        self._assert_contract(MIGRATION.read_text(encoding="utf-8"))

    def test_disaster_recovery_overlay_preserves_same_contract(self) -> None:
        self._assert_contract(BASELINE_OVERLAY.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
