from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_build_pipeline import HtmlTransformStats  # noqa: E402
from static_build_runner import build_static_publish  # noqa: E402


class StaticBuildRunnerTests(unittest.TestCase):
    def test_runs_static_build_pipeline_in_order(self) -> None:
        root = Path("/tmp/project")
        publish = root / "_site"
        copied_files = [Path("index.html"), Path("app.js")]
        transform_stats = HtmlTransformStats(enhanced_files=3, dependency_injections=4)
        calls: list[str] = []

        with (
            patch("static_build_runner.prepare_publish_directory", side_effect=lambda path: calls.append("prepare")) as prepare,
            patch("static_build_runner.copy_public_files", side_effect=lambda source, target: (calls.append("copy"), copied_files)[1]) as copy,
            patch("static_build_runner.transform_copied_html", side_effect=lambda target, files: (calls.append("transform"), transform_stats)[1]) as transform,
            patch("static_build_runner.materialize_clean_route_aliases", side_effect=lambda source, target: (calls.append("aliases"), 5)[1]) as aliases,
            patch("static_build_runner.validate_publish_dependencies", side_effect=lambda target: calls.append("dependencies")) as dependencies,
            patch("static_build_runner.install_shared_headers", side_effect=lambda source, target: calls.append("headers")) as headers,
            patch("static_build_runner.validate_publish", side_effect=lambda target: calls.append("validate")) as validate,
        ):
            result = build_static_publish(root, publish)

        self.assertEqual(
            calls,
            ["prepare", "copy", "transform", "aliases", "dependencies", "headers", "validate"],
        )
        self.assertEqual(result.public_file_count, 2)
        self.assertEqual(result.transform_stats, transform_stats)
        self.assertEqual(result.clean_route_aliases, 5)
        prepare.assert_called_once_with(publish)
        copy.assert_called_once_with(root, publish)
        transform.assert_called_once_with(publish, copied_files)
        aliases.assert_called_once_with(root, publish)
        dependencies.assert_called_once_with(publish)
        headers.assert_called_once_with(root, publish)
        validate.assert_called_once_with(publish)


if __name__ == "__main__":
    unittest.main()
