from __future__ import annotations

import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "materialize_site.py"
SPEC = importlib.util.spec_from_file_location("materialize_site", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
materialize_site = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = materialize_site
SPEC.loader.exec_module(materialize_site)


class MaterializeSiteTests(unittest.TestCase):
    def test_publish_profile_preserves_existing_order(self) -> None:
        self.assertEqual(
            [step.script_name for step in materialize_site.PUBLISH_STEPS],
            [
                "inject_site_asset_loader.py",
                "inject_site_runtime_config.py",
                "inject_site_page_runtime.py",
                "inject_site_privacy_analytics.py",
                "inject_auth_module_loader.py",
                "inject_google_tag_manager.py",
            ],
        )

    def test_github_pages_profile_preserves_existing_order_and_aliases(self) -> None:
        self.assertEqual(
            [step.script_name for step in materialize_site.GITHUB_PAGES_STEPS],
            [
                "inject_auth_module_loader.py",
                "inject_site_asset_loader.py",
                "inject_site_runtime_config.py",
                "inject_site_page_runtime.py",
                "inject_site_privacy_analytics.py",
                "inject_google_tag_manager.py",
                "materialize_clean_route_aliases.py",
            ],
        )

    def test_materialize_site_invokes_each_step_once_with_absolute_root(self) -> None:
        calls: list[tuple[list[str], bool]] = []

        def fake_runner(command: list[str], check: bool):
            calls.append((command, check))
            return None

        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir).resolve()
            steps = (
                materialize_site.MaterializationStep("first.py"),
                materialize_site.MaterializationStep("second.py"),
            )
            materialize_site.materialize_site(root, steps, runner=fake_runner)

        self.assertEqual(len(calls), 2)
        self.assertTrue(all(check for _, check in calls))
        self.assertEqual(calls[0][0][-2:], ["--site-root", str(root)])
        self.assertEqual(calls[1][0][-2:], ["--site-root", str(root)])
        self.assertTrue(calls[0][0][1].endswith("/scripts/first.py"))
        self.assertTrue(calls[1][0][1].endswith("/scripts/second.py"))

    def test_materialize_site_rejects_missing_root_before_running_steps(self) -> None:
        calls: list[list[str]] = []

        def fake_runner(command: list[str], check: bool):
            calls.append(command)
            return None

        missing_root = Path(tempfile.gettempdir()) / "teacherflavius-missing-materialization-root"
        if missing_root.exists():
            self.fail(f"Unexpected test fixture path exists: {missing_root}")

        with self.assertRaises(SystemExit):
            materialize_site.materialize_site(
                missing_root,
                (materialize_site.MaterializationStep("first.py"),),
                runner=fake_runner,
            )

        self.assertEqual(calls, [])


if __name__ == "__main__":
    unittest.main()
