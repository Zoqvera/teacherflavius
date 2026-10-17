#!/usr/bin/env python3
"""Read-only Stage 5D checks against the actually published lesson pages.

No student session, database write, private content, or service-role key is used.
"""
from __future__ import annotations

import json
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


SITE = "https://teacherflavius.com"
SUPABASE_HOST = "wnigzpvgsbpjdxvjzugt.supabase.co"
MAX_RESPONSE_BYTES = 512_000

STUDENT_PAGE = "/licao/"
TEACHER_PAGE = "/roteiro-da-aula/"
STUDENT_SCRIPT = "/lesson_presentation_editor.js?v=20261017-stage5c-1"
TEACHER_SCRIPT = "/teacher_lesson_presentations.js?v=20261017-stage5c-1"
CLIENT_CONFIG = "/supabase_config.js?v=20260918-1"


class SmokeFailure(Exception):
    """A public release contract could not be verified."""


def retrieve(url: str, *, headers: dict[str, str] | None = None) -> tuple[int, str]:
    """Read one bounded HTTPS response without logging sensitive payloads."""
    if urlsplit(url).scheme != "https":
        raise SmokeFailure("An HTTPS-only request was expected.")
    request = Request(
        url,
        headers={"User-Agent": "TeacherFlavius-Stage5D-Smoke/1.0", "Cache-Control": "no-cache", **(headers or {})},
    )
    try:
        with urlopen(request, timeout=25) as response:
            if urlsplit(response.url).hostname != urlsplit(url).hostname:
                raise SmokeFailure("An unexpected redirect changed the origin.")
            data = response.read(MAX_RESPONSE_BYTES + 1)
            status = response.status
    except HTTPError as error:
        status = error.code
        data = error.read(MAX_RESPONSE_BYTES + 1)
    except (URLError, TimeoutError, OSError) as error:
        raise SmokeFailure(f"HTTPS request failed: {type(error).__name__}") from error
    if len(data) > MAX_RESPONSE_BYTES:
        raise SmokeFailure("Unexpectedly large public response.")
    return status, data.decode("utf-8", errors="replace")


def check_public_pages(read=retrieve) -> None:
    """Verify the deployed routes, indexation rules and both release gates."""
    def site(path: str) -> str:
        code, body = read(SITE + path)
        if code != 200:
            raise SmokeFailure(f"Public asset {path.split('?')[0]} returned HTTP {code}.")
        return body

    student_page = site(STUDENT_PAGE)
    teacher_page = site(TEACHER_PAGE)
    student_js = site(STUDENT_SCRIPT)
    teacher_js = site(TEACHER_SCRIPT)

    for page, name in ((student_page, "student"), (teacher_page, "teacher")):
        if not re.search(
            r'<meta\s+name=["\']robots["\']\s+content=["\']noindex,\s*nofollow["\']',
            page, re.IGNORECASE,
        ):
            raise SmokeFailure(f"Missing private-page noindex on {name} route.")

    if "lesson_presentation_editor.js?v=20261017-stage5c-1" not in student_page:
        raise SmokeFailure("Published student HTML is using an old editor script.")
    if "teacher_lesson_presentations.js?v=20261017-stage5c-1" not in teacher_page:
        raise SmokeFailure("Published teacher HTML is using an old viewer script.")
    if 'id="lessonPresentationSection"' not in student_page:
        raise SmokeFailure("Published student form container is missing.")
    if "const RELEASE_ENABLED = true;" not in student_js:
        raise SmokeFailure("Published student editor is not released.")
    if "const RELEASE_ENABLED = true;" not in teacher_js:
        raise SmokeFailure("Published teacher viewer is not released.")
    if "window.LessonPresentationEditor" not in student_js:
        raise SmokeFailure("Published student editor has no public module.")
    if "window.TeacherLessonPresentations" not in teacher_js:
        raise SmokeFailure("Published teacher viewer has no public module.")


def parse_public_key(script: str) -> str:
    """Extract only the publishable client key already present in public JS."""
    host = re.search(r'\burl:\s*["\'](https://[^"\']+)["\']', script)
    key = re.search(r'\banonKey:\s*["\']([^"\']+)["\']', script)
    if not host or urlsplit(host.group(1)).hostname != SUPABASE_HOST or not key:
        raise SmokeFailure("Unexpected or missing Supabase public client configuration.")
    return key.group(1)


def check_anonymous_rls(read=retrieve) -> None:
    """Guests must not retrieve presentations, history or read receipts."""
    status, client_js = read(SITE + CLIENT_CONFIG)
    if status != 200:
        raise SmokeFailure(f"Public Supabase configuration returned HTTP {status}.")
    anon_key = parse_public_key(client_js)
    for table in (
        "lesson_presentations",
        "lesson_presentation_versions",
        "lesson_presentation_views",
    ):
        endpoint = f"https://{SUPABASE_HOST}/rest/v1/{table}?select=*&limit=1"
        status, body = read(
            endpoint,
            headers={"apikey": anon_key, "Authorization": f"Bearer {anon_key}"},
        )
        if status == 200:
            try:
                rows = json.loads(body)
            except json.JSONDecodeError as error:
                raise SmokeFailure(f"Non-JSON response from {table}.") from error
            if rows != []:
                raise SmokeFailure(f"Anonymous access exposed data in {table}.")
        elif status not in (401, 403):
            raise SmokeFailure(f"Unexpected anonymous Data API status for {table}: {status}.")


def main() -> int:
    try:
        check_public_pages()
        print("PASS: published student/teacher pages, gated modules and noindex")
        check_anonymous_rls()
        print("PASS: three anonymous Supabase Data API read restrictions")
        return 0
    except SmokeFailure as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
