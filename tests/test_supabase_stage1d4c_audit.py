"""Static contracts for the metadata-only stage 1D.4C reconciliation audit."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "docs/supabase-rls-stage1d4c-snapshot.json"
REPORT = ROOT / "docs/supabase-rls-auditoria-etapa-1d4c.md"
INVENTORY_WORKFLOW = ROOT / ".github/workflows/supabase-schema-object-inventory.yml"


class SupabaseStage1D4CAuditContracts(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))

    def test_snapshot_has_provenance_and_explicit_limits(self) -> None:
        source = self.snapshot["source"]
        self.assertEqual(self.snapshot["snapshot_date"], "2026-10-17")
        self.assertEqual(source["repository"], "Zoqvera/teacherflavius")
        self.assertRegex(source["commit"], r"^[0-9a-f]{40}$")
        self.assertEqual(source["workflow_run"], 39030867812)
        self.assertEqual(source["artifact"], 12099914402)
        limits = self.snapshot["limitations"]
        self.assertTrue(limits["metadata_only"])
        for key, value in limits.items():
            if key != "metadata_only":
                self.assertIs(value, False, key)
        self.assertNotIn("policy_sql", self.snapshot)
        self.assertNotIn("student_data", self.snapshot)

    def test_schema_inventory_arithmetic_is_consistent(self) -> None:
        schema = self.snapshot["schema"]
        kinds = list(schema["by_kind"].values())
        self.assertEqual(sum(kind["baseline"] for kind in kinds), schema["baseline_objects"])
        self.assertEqual(sum(kind["production"] for kind in kinds), schema["production_objects"])
        self.assertEqual(
            sum(kind["missing_in_baseline"] for kind in kinds),
            schema["missing_in_baseline"],
        )
        self.assertEqual(
            sum(kind["extra_in_baseline"] for kind in kinds),
            schema["extra_in_baseline"],
        )
        self.assertEqual(
            sum(kind["different_definitions"] for kind in kinds),
            schema["different_definitions"],
        )
        self.assertEqual(
            schema["identical_definitions"] + schema["different_definitions"],
            schema["shared_identifiers"],
        )
        self.assertEqual(
            schema["baseline_objects"] - schema["shared_identifiers"],
            schema["extra_in_baseline"],
        )
        self.assertEqual(
            schema["production_objects"] - schema["shared_identifiers"],
            schema["missing_in_baseline"],
        )

    def test_policy_gap_is_exclusively_on_absent_relations(self) -> None:
        rls = self.snapshot["rls"]
        self.assertEqual(rls["baseline_policies"], 95)
        self.assertEqual(rls["production_policies"], 109)
        self.assertEqual(rls["missing_policies"], 14)
        self.assertEqual(rls["missing_on_restored_relations"], 0)
        self.assertEqual(rls["missing_on_absent_relations"], 14)
        self.assertEqual(rls["changed_role_or_command"], 0)
        self.assertEqual(rls["changed_predicates_only"], 4)
        self.assertEqual(rls["potential_baseline_role_broadening"], 0)
        self.assertEqual(
            rls["matching_policies"] + rls["changed_predicates_only"],
            rls["baseline_policies"],
        )
        self.assertEqual(
            sum(rls["table_dependencies"].values()),
            rls["missing_policies"],
        )
        self.assertEqual(len(rls["table_dependencies"]), 11)
        self.assertTrue(
            all(name.startswith("public.") for name in rls["table_dependencies"])
        )
        self.assertNotIn("public.homework_relationship_events", rls["table_dependencies"])

    def test_human_report_discloses_critical_uncertainties(self) -> None:
        report = REPORT.read_text(encoding="utf-8")
        for marker in (
            "1.134",
            "175",
            "14",
            "11 relações",
            "não exige AAL2/MFA",
            "não demonstra equivalência",
            "PR #776",
            "SEO",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, report)
        self.assertIn("schema-object-gap-assessment", report)
        self.assertIn("protected_main_disposable_schema_inventory", str(self.snapshot["source"]["source_type"]))

    def test_workflow_runs_audit_contract_without_production_credentials(self) -> None:
        workflow = INVENTORY_WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("test_supabase_stage1d4c_audit.py", workflow)
        self.assertIn("schema-object-inventory-contracts:", workflow)
        self.assertIn("canonical-object-comparison:", workflow)
        self.assertIn("if: github.event_name != 'pull_request'", workflow)


if __name__ == "__main__":
    unittest.main()
