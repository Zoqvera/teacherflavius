from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import call, patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_postprocess_runner import run_production_postprocess  # noqa: E402


class ProductionPostprocessRunnerTests(unittest.TestCase):
    def test_requires_publish_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(SystemExit, "build_static_site.py"):
                run_production_postprocess(root, root / "_site")

    def test_runs_steps_in_expected_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish = root / "_site"
            publish.mkdir()
            events = []

            with (
                patch("production_postprocess_runner.update_homepage", side_effect=lambda value: events.append(("homepage", value))),
                patch("production_postprocess_runner.update_course_authority", side_effect=lambda value: events.append(("course", value))),
                patch("production_postprocess_runner.write_health_check", side_effect=lambda root_value, publish_value: events.append(("health", root_value, publish_value))),
            ):
                run_production_postprocess(root, publish)

            self.assertEqual(
                events,
                [
                    ("homepage", publish),
                    ("course", publish),
                    ("health", root, publish),
                ],
            )


if __name__ == "__main__":
    unittest.main()
