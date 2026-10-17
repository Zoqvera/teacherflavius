"""Verify that the physical Homeworks test bench is self-contained and synthetic."""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from static_site_files import is_public

OFFLINE = Path("tests/fixtures/homeworks-stage5-physical/offline.html")
SOURCES = (
    "homework_student_interface.css",
    "area-do-estudante/homeworks/foundation.css",
    "homework_pedagogical_preview.js",
    "homework_student_interface.js",
    "tests/fixtures/homeworks-stage5-visual.js",
)


def bundled_source(markup: str, path: str) -> str:
    name = "style" if path.endswith(".css") else "script"
    pattern = rf'<{name} data-source="{re.escape(path)}">\n(.*?)\n</{name}>'
    match = re.search(pattern, markup, re.DOTALL)
    if not match:
        raise AssertionError(f"Bundled source missing or ambiguous: {path}")
    return match.group(1)


class OfflinePhysicalAcceptanceFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.markup = (ROOT / OFFLINE).read_text(encoding="utf-8")

    def test_snapshot_matches_real_versioned_student_modules(self) -> None:
        for path in SOURCES:
            with self.subTest(path=path):
                source = (ROOT / path).read_text(encoding="utf-8")
                if path.endswith("homeworks-stage5-visual.js"):
                    source = source.replace(
                        "const params = new URLSearchParams(location.search);",
                        'const params = new URLSearchParams(location.search || location.hash.replace(/^#/, ""));',
                    )
                self.assertEqual(bundled_source(self.markup, path), source)

    def test_fixture_blocks_network_and_is_excluded_from_public_site(self) -> None:
        self.assertFalse(is_public(OFFLINE))
        self.assertIn("connect-src 'none'", self.markup)
        self.assertIn("default-src 'none'", self.markup)
        self.assertIn('name="robots" content="noindex, nofollow, noarchive"', self.markup)
        self.assertNotRegex(self.markup, r'<script\s+src\s*=')
        self.assertNotRegex(self.markup, r'<link\s+rel="stylesheet"')
        self.assertNotIn('fetch(', self.markup)

    def test_physical_evidence_is_not_reported_as_automatic_pass(self) -> None:
        self.assertIn('<option>Não executado</option>', self.markup)
        self.assertIn('data-case="A11Y-01"', self.markup)
        self.assertIn('data-case="A11Y-08"', self.markup)
        self.assertIn('id="saveReport"', self.markup)
        self.assertIn('location.hash = selected.toString()', self.markup)


if __name__ == "__main__":
    unittest.main()
