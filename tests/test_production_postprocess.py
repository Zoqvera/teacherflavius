from __future__ import annotations

import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_content import (  # noqa: E402
    COURSE_AUTHORITY_BLOCK,
    COURSE_INSERTION_ANCHOR,
    COURSE_SCHEMA_NEW,
    COURSE_SCHEMA_OLD,
    COURSE_TEACHER_NEW,
    COURSE_TEACHER_OLD,
    update_course_authority,
    update_homepage,
)
from production_health import build_health_payload, write_health_check  # noqa: E402


class ProductionContentTests(unittest.TestCase):
    def test_updates_homepage_idempotently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            index = publish / "index.html"
            index.write_text(
                '<section class="section" aria-labelledby="benefits-title">\n'
                '<h2 id="benefits-title">Inglês online com professor, prática e acompanhamento.</h2>\n'
                "</section>",
                encoding="utf-8",
            )

            update_homepage(publish)
            first = index.read_text(encoding="utf-8")
            update_homepage(publish)

            self.assertEqual(index.read_text(encoding="utf-8"), first)
            self.assertIn('aria-label="Como funcionam as aulas"', first)
            self.assertNotIn('id="benefits-title"', first)

    def test_updates_course_authority_idempotently(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            index = publish / "curso-de-ingles-online" / "index.html"
            index.parent.mkdir(parents=True)
            index.write_text(
                "<html><body>\n"
                + COURSE_SCHEMA_OLD
                + "\n"
                + COURSE_TEACHER_OLD
                + "\n"
                + COURSE_INSERTION_ANCHOR
                + "\n</body></html>",
                encoding="utf-8",
            )

            update_course_authority(publish)
            first = index.read_text(encoding="utf-8")
            update_course_authority(publish)

            self.assertEqual(index.read_text(encoding="utf-8"), first)
            self.assertIn(COURSE_SCHEMA_NEW, first)
            self.assertIn(COURSE_TEACHER_NEW, first)
            self.assertEqual(first.count(COURSE_AUTHORITY_BLOCK.strip()), 1)

    def test_rejects_course_without_expected_schema_anchor(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            publish = Path(directory)
            index = publish / "curso-de-ingles-online" / "index.html"
            index.parent.mkdir(parents=True)
            index.write_text("<html></html>", encoding="utf-8")

            with self.assertRaisesRegex(SystemExit, "Course Person schema anchor not found"):
                update_course_authority(publish)


class ProductionHealthTests(unittest.TestCase):
    def test_builds_deterministic_health_payload(self) -> None:
        generated_at = datetime(2026, 9, 3, 5, 0, tzinfo=timezone.utc)
        with patch("production_health.current_commit_sha", return_value="abc123"):
            payload = build_health_payload(Path("/tmp/site"), generated_at)

        self.assertEqual(
            payload,
            {
                "status": "ok",
                "service": "teacherflavius.com",
                "commit": "abc123",
                "generated_at": "2026-09-03T05:00:00Z",
            },
        )

    def test_writes_compact_health_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            publish = root / "_site"
            publish.mkdir()
            with patch("production_health.current_commit_sha", return_value="def456"):
                write_health_check(root, publish)

            payload = json.loads((publish / "health.json").read_text(encoding="utf-8"))
            self.assertEqual(payload["status"], "ok")
            self.assertEqual(payload["commit"], "def456")
            self.assertTrue(payload["generated_at"].endswith("Z"))


if __name__ == "__main__":
    unittest.main()
