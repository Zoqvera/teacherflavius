#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

from production_course_authority_content import (
    COURSE_INSERTION_ANCHOR,
    COURSE_INSERTION_REPLACEMENT,
    COURSE_SCHEMA_NEW,
    COURSE_SCHEMA_OLD,
    COURSE_TEACHER_NEW,
    COURSE_TEACHER_OLD,
)
from production_html_transform import apply_html_transform

COURSE_PAGE_PATH = Path("curso-de-ingles-online") / "index.html"
COURSE_PAGE_MISSING_MESSAGE = "Static build missing _site/curso-de-ingles-online/index.html"


def transform_course_authority_html(html: str) -> str:
    transformed = html

    if COURSE_SCHEMA_NEW not in transformed:
        if COURSE_SCHEMA_OLD not in transformed:
            raise SystemExit("Course Person schema anchor not found")
        transformed = transformed.replace(COURSE_SCHEMA_OLD, COURSE_SCHEMA_NEW, 1)

    if COURSE_TEACHER_NEW not in transformed:
        if COURSE_TEACHER_OLD not in transformed:
            raise SystemExit("Course teacher authority anchor not found")
        transformed = transformed.replace(COURSE_TEACHER_OLD, COURSE_TEACHER_NEW, 1)

    if 'id="academicAuthorityProof"' not in transformed:
        if COURSE_INSERTION_ANCHOR not in transformed:
            raise SystemExit("Course authority insertion anchor not found")
        transformed = transformed.replace(
            COURSE_INSERTION_ANCHOR,
            COURSE_INSERTION_REPLACEMENT,
            1,
        )

    return transformed


def update_course_authority(publish: Path) -> None:
    apply_html_transform(
        publish,
        COURSE_PAGE_PATH,
        transform_course_authority_html,
        missing_message=COURSE_PAGE_MISSING_MESSAGE,
    )
