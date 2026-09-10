from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from html_script_dependency_runtime import process_site  # noqa: E402
from html_script_dependency_transform import (  # noqa: E402
    ensure_dependency_before_target,
    validate_dependency_order,
)
from script_dependency_spec import ScriptDependencySpec  # noqa: E402


class HtmlScriptDependencyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.spec = ScriptDependencySpec(
            dependency_src="/dependency.js?v=1",
            dependency_filename="dependency.js",
            target_filename="target.js",
            validation_message="dependency must precede target in {path}",
        )

    def test_inserts_dependency_before_target_with_matching_indentation(self) -> None:
        html = "<body>\n  <script src=\"/target.js\"></script>\n</body>\n"
        updated, modified = ensure_dependency_before_target(html, self.spec)
        self.assertTrue(modified)
        self.assertIn(
            '  <script src="/dependency.js?v=1"></script>\n  <script src="/target.js"></script>',
            updated,
        )

    def test_keeps_valid_existing_dependency_idempotently(self) -> None:
        html = '<script src="/dependency.js?v=1"></script>\n<script src="/target.js"></script>\n'
        updated, modified = ensure_dependency_before_target(html, self.spec)
        self.assertFalse(modified)
        self.assertEqual(updated, html)

    def test_moves_dependency_that_appears_after_target(self) -> None:
        html = '<script src="/target.js"></script>\n<script src="/dependency.js?v=1"></script>\n'
        updated, modified = ensure_dependency_before_target(html, self.spec)
        self.assertTrue(modified)
        self.assertLess(updated.index("dependency.js"), updated.index("target.js"))
        self.assertEqual(updated.count("dependency.js"), 1)

    def test_replaces_stale_dependency_when_current_src_is_required(self) -> None:
        versioned_spec = ScriptDependencySpec(
            dependency_src="/dependency.js?v=2",
            dependency_filename="dependency.js",
            target_filename="target.js",
            validation_message="current dependency must precede target in {path}",
            require_current_src=True,
        )
        html = '<script src="/dependency.js?v=1"></script>\n<script src="/target.js"></script>\n'
        updated, modified = ensure_dependency_before_target(html, versioned_spec)
        self.assertTrue(modified)
        self.assertIn('/dependency.js?v=2', updated)
        self.assertNotIn('/dependency.js?v=1', updated)

    def test_process_site_updates_only_html_files_with_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target.html"
            untouched = root / "other.html"
            target.write_text('<script src="/target.js"></script>\n', encoding="utf-8")
            untouched.write_text("<p>Sem target</p>\n", encoding="utf-8")
            changed = process_site(root, self.spec)
            self.assertEqual(changed, 1)
            self.assertIn("dependency.js", target.read_text(encoding="utf-8"))
            self.assertEqual(untouched.read_text(encoding="utf-8"), "<p>Sem target</p>\n")

    def test_validation_rejects_missing_dependency(self) -> None:
        html = '<script src="/target.js"></script>\n'
        with self.assertRaises(SystemExit):
            validate_dependency_order(html, Path("index.html"), self.spec)


if __name__ == "__main__":
    unittest.main()
