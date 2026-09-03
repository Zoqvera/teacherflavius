#!/usr/bin/env python3
from __future__ import annotations

from production_course_authority import (
    COURSE_AUTHORITY_BLOCK,
    COURSE_INSERTION_ANCHOR,
    COURSE_INSERTION_REPLACEMENT,
    COURSE_SCHEMA_NEW,
    COURSE_SCHEMA_OLD,
    COURSE_TEACHER_NEW,
    COURSE_TEACHER_OLD,
    update_course_authority,
)
from production_homepage import update_homepage

__all__ = (
    "COURSE_AUTHORITY_BLOCK",
    "COURSE_INSERTION_ANCHOR",
    "COURSE_INSERTION_REPLACEMENT",
    "COURSE_SCHEMA_NEW",
    "COURSE_SCHEMA_OLD",
    "COURSE_TEACHER_NEW",
    "COURSE_TEACHER_OLD",
    "update_course_authority",
    "update_homepage",
)
