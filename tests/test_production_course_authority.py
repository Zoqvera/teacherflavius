from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

from production_course_authority import (  # noqa: E402
    COURSE_AUTHORITY_BLOCK,
    COURSE_INSERTION_ANCHOR,
    COURSE_SCHEMA_NEW,
    COURSE_SCHEMA_OLD,
    COURSE_TEACHER_NEW,
    COURSE_TEACHER_OLD,
    transform_course_authority_html,
    update_course_authority,
)


class ProductionCourseAuthorityTests(unittest.TestCase):
    def source_html(self) -> str:
        return (
            "<html><body>\n"
            + COURSE_SCHEMA_OLD
            + "\n"
            + COURSE_TEACHER_OLD
            + "\n"
            + COURSE_INSERTION_ANCHOR
            + "\n</body></html>"
        )

    def test_transforms_course_authority(self) -> None:
        transformed = transform_course_authority_html(self.source_html())

        self.assertIn(COURSE_SCHEMA_NEW, transformed)
        self.assertIn(COURSE_TEACHER_NEW, transformed)
        self.assertEqual(transformed.count(COURSE_AUTHORITY_BLOCK.strip()), 1)

    def test_transformation_is_idempotent(self) -> None:
        first = transform_course_authority_html(self.source_html())
        second = transform_course_authority_html(first)
        self.assertEqual(second, first)

    def test_rejects_missing_schema_anchor(self) -> None:
        with self.assertRaisesRegex(SystemExit, "Course Person schema anchor not found"):
            transform_course_authority_html("<html></html>")

    def test_update_requires_course_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(SystemExit):
                update_course_authority(Path(directory))


if __name__ == "__main__":
    unittest.main()
