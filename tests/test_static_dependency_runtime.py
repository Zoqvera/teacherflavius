from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from script_dependency_spec import ScriptDependencySpec  # noqa: E402
from static_dependency_runtime import (  # noqa: E402
    inject_dependencies,
    inject_dependency_groups,
    validate_html_dependencies,
    validate_publish_dependencies,
)


def dependency(src: str, filename: str, target: str) -> ScriptDependencySpec:
    return ScriptDependencySpec(
        dependency_src=src,
        dependency_filename=filename,
        target_filename=target,
        validation_message="dependency order invalid: {path}",
    )


class StaticDependencyRuntimeTests(unittest.TestCase):
    def test_injects_group_before_target_and_counts_changes(self) -> None:
        spec = dependency("/helper.js?v=1", "helper.js", "target.js")
        html, injections = inject_dependencies('<script src="/target.js"></script>', (spec,))

        self.assertEqual(injections, 1)
        self.assertLess(html.index("/helper.js?v=1"), html.index("/target.js"))

    def test_aggregates_multiple_dependency_groups(self) -> None:
        first = dependency("/first.js", "first.js", "target.js")
        second = dependency("/second.js", "second.js", "target.js")
        html, injections = inject_dependency_groups(
            '<script src="/target.js"></script>',
            ((first,), (second,)),
        )

        self.assertEqual(injections, 2)
        self.assertIn("/first.js", html)
        self.assertIn("/second.js", html)

    def test_validation_rejects_missing_dependency(self) -> None:
        spec = dependency("/helper.js", "helper.js", "target.js")
        with self.assertRaises(SystemExit):
            validate_html_dependencies(
                '<script src="/target.js"></script>',
                Path("index.html"),
                ((spec,),),
            )

    def test_validates_all_html_files_in_publish_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            (publish / "index.html").write_text("<html></html>", encoding="utf-8")
            validate_publish_dependencies(publish)


if __name__ == "__main__":
    unittest.main()
