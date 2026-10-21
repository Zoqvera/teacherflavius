"""Contracts for read-only, fail-closed sensitive LGPD function inventory."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.audit_supabase_sensitive_privacy_functions import (
    AUTHENTICATED_WRAPPERS,
    EXPECTED,
    SERVICE_ONLY,
    audit,
    main,
    parse_inventory,
)

ROOT = Path(__file__).resolve().parents[1]


def example(name: str, *, anonymous: bool = False, direct: bool | None = None) -> str:
    authenticated = name in AUTHENTICATED_WRAPPERS if direct is None else direct
    fields = (
        f"{name}(uuid)",
        "true",
        str(anonymous).lower(),
        str(authenticated).lower(),
        "true",
        "true",
        "false",
        "true",
    )
    return "\t".join(fields)


def inventory() -> str:
    return "\n".join(example(name) for name in sorted(EXPECTED))


class SensitivePrivacyFunctionTests(unittest.TestCase):
    def test_authorization_categories_cover_all_current_functions(self) -> None:
        self.assertEqual(len(EXPECTED), 24)
        self.assertEqual(len(AUTHENTICATED_WRAPPERS), 14)
        self.assertEqual(len(SERVICE_ONLY), 10)
        self.assertFalse(AUTHENTICATED_WRAPPERS & SERVICE_ONLY)

    def test_expected_metadata_still_requires_privileged_flow_review(self) -> None:
        report = audit(parse_inventory(inventory()))
        self.assertEqual(report.status, "PRIVACY_HIGH_PRIVILEGE_REVIEW_REQUIRED")
        self.assertEqual(report.inspected_functions, 24)
        self.assertEqual(report.authenticated_wrappers, 14)
        self.assertEqual(report.service_only_functions, 10)
        self.assertEqual(report.anon_exposed, 0)
        self.assertFalse(report.function_authorization_verified)
        self.assertFalse(report.mfa_enforcement_verified)
        self.assertFalse(report.production_write_authorized)
        self.assertFalse(report.function_definitions_exported)

    def test_detects_anonymous_or_unreviewed_function_access(self) -> None:
        variants = [
            inventory().replace(
                example("delete_teacher_student"),
                example("delete_teacher_student", anonymous=True),
            ),
            inventory().replace(
                example("perform_data_retention_maintenance"),
                example("perform_data_retention_maintenance", direct=True),
            ),
            inventory().replace("true\ttrue\tfalse\ttrue", "true\tfalse\tfalse\ttrue", 1),
            inventory().replace("cancel_my_account_deletion_request(uuid)", "unexpected_privacy_rpc(uuid)"),
            inventory().split("\n", 1)[1],
        ]
        for raw in variants:
            with self.subTest(raw=raw[:45]):
                report = audit(parse_inventory(raw))
                self.assertEqual(report.status, "PRIVACY_PRIVILEGE_BOUNDARY_VIOLATION")

    def test_rejects_raw_sql_or_malformed_catalog(self) -> None:
        for contents in (
            "",
            "drop function dangerous;",
            example("get_my_data_export").replace("\ttrue\t", "\tauth.uid()\t", 1),
            example("get_my_data_export") + "\n" + example("get_my_data_export"),
            example("get_my_data_export") + "\textra",
        ):
            with self.subTest(contents=contents[:50]):
                with self.assertRaises(ValueError):
                    parse_inventory(contents)

    def test_metadata_sql_never_selects_data_or_exposes_function_definitions(self) -> None:
        sql = (
            ROOT / "scripts/sql/supabase_sensitive_privacy_functions_readonly.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("pg_catalog.pg_proc", sql)
        self.assertIn("has_function_privilege", sql)
        self.assertIn("position('aal2'", sql)
        self.assertNotIn("select *", sql)
        self.assertNotIn("pg_get_functiondef(p.oid) as", sql)
        for expression in (
            "delete from",
            "insert into",
            "update public.",
            "alter function",
            "supabase_migrations.schema_migrations",
        ):
            self.assertNotIn(expression, sql)

    def test_audit_snapshot_is_self_consistent_and_not_an_authorization_claim(self) -> None:
        snapshot = json.loads(
            (ROOT / "docs/supabase-privacy-stage1d6-snapshot.json").read_text(
                encoding="utf-8"
            )
        )
        inv = snapshot["object_inventory"]
        self.assertEqual(
            inv["matching_definitions"] + inv["differing_definitions"],
            inv["common_objects"],
        )
        self.assertEqual(
            inv["production_objects"] - inv["common_objects"],
            inv["missing_in_baseline"],
        )
        rls = snapshot["rls"]
        self.assertEqual(sum(rls["dependencies"].values()), rls["missing_policies"])
        self.assertEqual(rls["missing_on_restored_relations"], 0)
        self.assertEqual(rls["missing_on_absent_relations"], 10)
        functions = snapshot["sensitive_privacy_functions"]
        self.assertEqual(functions["privileged_function_count"], len(EXPECTED))
        self.assertEqual(
            functions["allowed_authenticated_execute"]
            + functions["restricted_service_only"],
            functions["privileged_function_count"],
        )
        self.assertFalse(functions["mfa_enforcement_verified"])
        limits = snapshot["limits"]
        self.assertTrue(limits["metadata_only"])
        self.assertFalse(limits["production_write_authorized"])
        self.assertFalse(limits["function_definitions_exported"])

    def test_cli_creates_metadata_only_report(self) -> None:
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as folder:
            src = Path(folder) / "functions.tsv"
            target = Path(folder) / "report.json"
            src.write_text(inventory(), encoding="utf-8")
            with patch("sys.argv", [
                "audit",
                "--inventory", str(src),
                "--output", str(target),
            ]):
                self.assertEqual(main(), 0)
            report = json.loads(target.read_text(encoding="utf-8"))
            self.assertTrue(report["metadata_only"])
            self.assertFalse(report["student_data_exported"])
            self.assertFalse(report["mfa_enforcement_verified"])
            self.assertEqual(report["status"], "PRIVACY_HIGH_PRIVILEGE_REVIEW_REQUIRED")


if __name__ == "__main__":
    unittest.main()
