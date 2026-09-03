from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_site_files import copy_public_files, is_public, public_tracked_files  # noqa: E402


class StaticSiteFilesTests(unittest.TestCase):
    def test_accepts_supported_public_file(self) -> None:
        self.assertTrue(is_public(Path("assets/app.js")))
        self.assertTrue(is_public(Path("index.html")))

    def test_accepts_special_public_file_without_suffix(self) -> None:
        self.assertTrue(is_public(Path("_redirects")))

    def test_rejects_blocked_and_hidden_paths(self) -> None:
        self.assertFalse(is_public(Path("scripts/build_static_site.py")))
        self.assertFalse(is_public(Path(".github/workflows/build.yml")))
        self.assertFalse(is_public(Path("assets/.private/data.json")))
        self.assertFalse(is_public(Path("CNAME")))

    def test_rejects_unsupported_suffix(self) -> None:
        self.assertFalse(is_public(Path("notes.md")))
        self.assertFalse(is_public(Path("schema.sql")))

    def test_public_tracked_files_requires_existing_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            existing = root / "app.js"
            existing.write_text("ok", encoding="utf-8")

            with patch("static_site_files.tracked_files", return_value=[Path("app.js"), Path("missing.js"), Path("tests/test.js")]):
                self.assertEqual(public_tracked_files(root), [Path("app.js")])

    def test_copy_public_files_preserves_relative_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"
            publish = Path(directory) / "publish"
            source = root / "assets" / "app.js"
            source.parent.mkdir(parents=True)
            source.write_text("console.log('ok');", encoding="utf-8")

            with patch("static_site_files.tracked_files", return_value=[Path("assets/app.js")]):
                copied = copy_public_files(root, publish)

            self.assertEqual(copied, [Path("assets/app.js")])
            self.assertEqual((publish / "assets" / "app.js").read_text(encoding="utf-8"), source.read_text(encoding="utf-8"))

    def test_copy_public_files_includes_special_public_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "root"
            publish = Path(directory) / "publish"
            redirects = root / "_redirects"
            root.mkdir(parents=True)
            redirects.write_text("/* /index.html 200", encoding="utf-8")

            with patch("static_site_files.tracked_files", return_value=[Path("_redirects")]):
                copied = copy_public_files(root, publish)

            self.assertEqual(copied, [Path("_redirects")])
            self.assertEqual((publish / "_redirects").read_text(encoding="utf-8"), redirects.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
