"""Isolated regression tests for the secretless live release smoke."""
from __future__ import annotations

import unittest

from scripts.smoke_lesson_presentations_public import (
    CLIENT_CONFIG,
    SITE,
    STUDENT_PAGE,
    STUDENT_SCRIPT,
    SUPABASE_HOST,
    TEACHER_PAGE,
    TEACHER_SCRIPT,
    SmokeFailure,
    check_anonymous_rls,
    check_public_pages,
    parse_public_key,
)


STUDENT_HTML = (
    '<meta name="robots" content="noindex,nofollow">'
    '<section id="lessonPresentationSection" hidden></section>'
    '<script src="/lesson_presentation_editor.js?v=20261017-stage5c-1"></script>'
)
TEACHER_HTML = (
    '<meta name="robots" content="noindex, nofollow">'
    '<script src="/teacher_lesson_presentations.js?v=20261017-stage5c-1"></script>'
)
EDITOR = "const RELEASE_ENABLED = true; window.LessonPresentationEditor = {};"
VIEWER = "const RELEASE_ENABLED = true; window.TeacherLessonPresentations = {};"
PUBLIC_KEY = "synthetic-publishable-key"
CONFIG = (
    'window.SUPABASE_CONFIG = {'
    'url: "https://wnigzpvgsbpjdxvjzugt.supabase.co", '
    'anonKey: "' + PUBLIC_KEY + '"};'
)


def static_loader(overrides=None):
    fixtures = {
        SITE + STUDENT_PAGE: (200, STUDENT_HTML),
        SITE + TEACHER_PAGE: (200, TEACHER_HTML),
        SITE + STUDENT_SCRIPT: (200, EDITOR),
        SITE + TEACHER_SCRIPT: (200, VIEWER),
    }
    fixtures.update(overrides or {})

    def read(url, *, headers=None):
        return fixtures[url]

    return read


class PublicPresentationSmokeTests(unittest.TestCase):
    def test_correct_private_markup_and_released_assets(self):
        check_public_pages(static_loader())

    def test_stale_student_js_is_not_accepted(self):
        with self.assertRaisesRegex(SmokeFailure, "student editor is not released"):
            check_public_pages(static_loader({
                SITE + STUDENT_SCRIPT: (200, "const RELEASE_ENABLED = false;")
            }))

    def test_stale_teacher_reference_is_not_accepted(self):
        with self.assertRaisesRegex(SmokeFailure, "old viewer script"):
            check_public_pages(static_loader({
                SITE + TEACHER_PAGE: (200, TEACHER_HTML.replace(
                    "20261017-stage5c-1", "20261017-stage3-1"
                ))
            }))

    def test_noindex_is_mandatory(self):
        with self.assertRaisesRegex(SmokeFailure, "Missing private-page noindex"):
            check_public_pages(static_loader({
                SITE + STUDENT_PAGE: (200, STUDENT_HTML.replace(
                    '<meta name="robots" content="noindex,nofollow">', ""
                ))
            }))

    def test_public_key_rejects_wrong_project_or_missing_key(self):
        self.assertEqual(parse_public_key(CONFIG), PUBLIC_KEY)
        with self.assertRaises(SmokeFailure):
            parse_public_key(CONFIG.replace(SUPABASE_HOST, "other.supabase.co"))
        with self.assertRaises(SmokeFailure):
            parse_public_key(CONFIG.replace("anonKey", "otherKey"))

    def test_all_anonymous_table_reads_can_be_denied(self):
        inspected = []

        def read(url, *, headers=None):
            if url == SITE + CLIENT_CONFIG:
                return 200, CONFIG
            self.assertEqual(headers["apikey"], PUBLIC_KEY)
            self.assertEqual(headers["Authorization"], f"Bearer {PUBLIC_KEY}")
            inspected.append(url)
            return 401, '{"code":"42501"}'

        check_anonymous_rls(read)
        self.assertEqual(len(inspected), 3)

    def test_empty_anonymous_result_is_safe(self):
        def read(url, *, headers=None):
            return (200, CONFIG) if url == SITE + CLIENT_CONFIG else (200, "[]")

        check_anonymous_rls(read)

    def test_anonymous_data_exposure_or_missing_api_fails(self):
        for status, response in ((200, '[{"id":"synthetic"}]'), (404, "{}"), (503, "{}")):
            def read(url, *, headers=None):
                return (200, CONFIG) if url == SITE + CLIENT_CONFIG else (status, response)

            with self.subTest(status=status), self.assertRaises(SmokeFailure):
                check_anonymous_rls(read)


if __name__ == "__main__":
    unittest.main()
