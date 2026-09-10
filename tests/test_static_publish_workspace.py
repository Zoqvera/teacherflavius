from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_publish_workspace import prepare_publish_directory  # noqa: E402


class StaticPublishWorkspaceTests(unittest.TestCase):
    def test_creates_missing_publish_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory) / "_site"
            prepare_publish_directory(publish)
            self.assertTrue(publish.is_dir())

    def test_clears_existing_publish_contents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory) / "_site"
            nested = publish / "nested"
            nested.mkdir(parents=True)
            (nested / "stale.txt").write_text("stale", encoding="utf-8")

            prepare_publish_directory(publish)

            self.assertTrue(publish.is_dir())
            self.assertEqual(list(publish.iterdir()), [])

    def test_preserves_sibling_files_outside_publish_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            sibling = root / "keep.txt"
            sibling.write_text("keep", encoding="utf-8")
            publish = root / "_site"
            publish.mkdir()

            prepare_publish_directory(publish)

            self.assertEqual(sibling.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
