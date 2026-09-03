from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from static_hosting_headers import install_shared_headers  # noqa: E402
from static_publish_leaks import leaked_operational_files  # noqa: E402
from static_publish_requirements import REQUIRED_PUBLIC_PATHS  # noqa: E402
from static_site_validation import missing_required_files, validate_publish  # noqa: E402


class StaticSiteValidationTests(unittest.TestCase):
    def create_complete_publish(self, root: Path) -> Path:
        publish = root / "_site"
        for relative in REQUIRED_PUBLIC_PATHS:
            path = publish / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("ok", encoding="utf-8")
        return publish

    def test_installs_shared_headers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "netlify" / "_headers"
            source.parent.mkdir(parents=True)
            source.write_text("/*\n  X-Test: true\n", encoding="utf-8")
            publish = root / "_site"
            publish.mkdir()

            install_shared_headers(root, publish)

            self.assertEqual((publish / "_headers").read_text(encoding="utf-8"), source.read_text(encoding="utf-8"))

    def test_reports_missing_required_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            missing = missing_required_files(publish)
            self.assertIn("index.html", missing)
            self.assertIn("_headers", missing)

    def test_reports_operational_file_leaks(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            (publish / "safe.js").write_text("ok", encoding="utf-8")
            (publish / "nested").mkdir()
            (publish / "nested" / "secret.py").write_text("pass", encoding="utf-8")

            self.assertEqual(leaked_operational_files(publish), ["nested/secret.py"])

    def test_accepts_complete_clean_publish(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = self.create_complete_publish(Path(directory))
            validate_publish(publish)

    def test_rejects_operational_file_leak(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = self.create_complete_publish(Path(directory))
            (publish / "debug.sql").write_text("select 1", encoding="utf-8")

            with self.assertRaisesRegex(SystemExit, "Operational files leaked"):
                validate_publish(publish)


if __name__ == "__main__":
    unittest.main()
