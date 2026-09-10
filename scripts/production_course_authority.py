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
COURSE_SCHEMA_AUTHORITY_MARKERS = (
    '"@id":"https://teacherflavius.com/#teacher"',
    '"knowsAbout":[',
    '"https://orcid.org/0000-0002-8972-5870"',
)
COURSE_VIDEO_TRIGGER_OPEN = (
    '<button class="course-free-class-trigger" id="courseFreeClassTrigger" type="button" '
    'aria-label="Reproduzir aula gratuita do Teacher Flávio">'
)
COURSE_VIDEO_THUMBNAIL = (
    '<img class="course-free-class-trigger-image" '
    'src="/assets/home-free-class-thumbnail.jpg?v=20260908-1" '
    'alt="" loading="lazy" decoding="async">'
)


def has_current_course_person_schema(html: str) -> bool:
    return all(marker in html for marker in COURSE_SCHEMA_AUTHORITY_MARKERS)


def inject_lazy_course_video_thumbnail(html: str) -> str:
    if 'class="course-free-class-trigger-image"' in html:
        return html
    if COURSE_VIDEO_TRIGGER_OPEN not in html:
        return html
    return html.replace(
        COURSE_VIDEO_TRIGGER_OPEN,
        COURSE_VIDEO_TRIGGER_OPEN + "\n              " + COURSE_VIDEO_THUMBNAIL,
        1,
    )


def transform_course_authority_html(html: str) -> str:
    transformed = html

    if COURSE_SCHEMA_NEW not in transformed and not has_current_course_person_schema(transformed):
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

    return inject_lazy_course_video_thumbnail(transformed)


def update_course_authority(publish: Path) -> None:
    apply_html_transform(
        publish,
        COURSE_PAGE_PATH,
        transform_course_authority_html,
        missing_message=COURSE_PAGE_MISSING_MESSAGE,
    )
