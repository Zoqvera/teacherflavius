"""Unit tests for read-only suspended-portal production monitoring."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from monitor_suspended_portal import (
    LEGACY_PAGES,
    PUBLISHED_PATHS,
    SUSPENSION_MESSAGE,
    validate_anonymous_access,
    validate_published_pages,
)


def valid_pages() -> dict[str, str]:
    pages = {path: "" for path in PUBLISHED_PATHS}
    for path in LEGACY_PAGES:
        pages[path] = "<main><h1>" + SUSPENSION_MESSAGE + "</h1></main>"
    pages["/area-do-estudante/"] = 'sourcePage + "?v=20261015-invitation-retry-1" { cache: \'no-store\' }'
    pages["/area_do_estudante.html"] = (
        '<a href="/flashcards/">Flashcards</a>'
        '<script src="/area_do_estudante.js?v=20261016-retire-week-1"></script>'
    )
    pages["/area_do_estudante.js"] = 'removeUnavailableStudentCards(); "/minha-semana"'
    pages["/minha-semana/"] = (
        '<h1>Minha Semana descontinuada</h1>'
        '<a href="/area-do-estudante/">VOLTAR</a>'
    )
    pages["/curso-de-ingles-online/"] = "Portal de Exercícios ... Portal de Exercícios"
    pages["/service-worker.js"] = 'if (!isInstallAsset(event.request)) return;'
    pages["/supabase_config.js"] = (
        'url: "https://wnigzpvgsbpjdxvjzugt.supabase.co", '
        'anonKey: "synthetic-public-key"'
    )
    return pages


class SuspendedPortalMonitoringTests(unittest.TestCase):
    def test_valid_pages_preserve_student_and_marketing_contracts(self) -> None:
        self.assertEqual(validate_published_pages(valid_pages()), [])

    def test_student_cache_wrapper_accepts_new_versions_but_rejects_stale_ones(self) -> None:
        current = valid_pages()
        self.assertEqual(validate_published_pages(current), [])

        older = valid_pages()
        older["/area-do-estudante/"] = (
            'sourcePage + "?v=20261014-old" { cache: \'no-store\' }'
        )
        self.assertTrue(any(
            "atualização de cache" in issue
            for issue in validate_published_pages(older)
        ))

        missing_no_store = valid_pages()
        missing_no_store["/area-do-estudante/"] = (
            'sourcePage + "?v=20261015-current"'
        )
        self.assertTrue(any(
            "atualização de cache" in issue
            for issue in validate_published_pages(missing_no_store)
        ))

    def test_reappearing_legacy_student_card_fails(self) -> None:
        pages = valid_pages()
        pages["/area_do_estudante.html"] += (
            '<a class="menu-button" href="/exercicios-diarios/">Portal</a>'
        )
        self.assertTrue(
            any("link para o portal antigo" in item for item in validate_published_pages(pages))
        )

    def test_weekly_dashboard_reactivation_fails(self) -> None:
        pages = valid_pages()
        pages["/minha-semana/"] += '<script src="/minha_semana_dashboard.js"></script>'
        self.assertTrue(
            any("Minha Semana:" in item for item in validate_published_pages(pages))
        )

    def test_retired_week_link_reappearing_in_student_area_fails(self) -> None:
        pages = valid_pages()
        pages["/area_do_estudante.html"] += '<a href="/minha-semana/">Minha Semana</a>'
        self.assertTrue(
            any("Minha Semana descontinuado reapareceu" in item for item in validate_published_pages(pages))
        )

    def test_published_portal_must_keep_suspension_banner(self) -> None:
        pages = valid_pages()
        pages["/exercicios-diarios/"] = "<main>Exercícios</main>"
        self.assertTrue(
            any("aviso de suspensão ausente" in item for item in validate_published_pages(pages))
        )

    def test_public_course_mentions_must_be_preserved(self) -> None:
        pages = valid_pages()
        pages["/curso-de-ingles-online/"] = "Portal de Exercícios"
        self.assertTrue(
            any("Apresentação do curso" in item for item in validate_published_pages(pages))
        )

    def test_anonymous_database_denial_is_accepted(self) -> None:
        config = valid_pages()["/supabase_config.js"]
        self.assertEqual(
            validate_anonymous_access(config, lambda *_args: (403, None)),
            [],
        )
        self.assertEqual(
            validate_anonymous_access(config, lambda *_args: (200, [])),
            [],
        )

    def test_anonymous_database_exposure_is_rejected(self) -> None:
        config = valid_pages()["/supabase_config.js"]
        problems = validate_anonymous_access(
            config,
            lambda *_args: (200, [{"id": "unexpected-record"}]),
        )
        self.assertEqual(len(problems), 2)
        self.assertTrue(all("expôs dados" in item for item in problems))

    def test_does_not_expose_public_key_in_errors(self) -> None:
        config = valid_pages()["/supabase_config.js"]
        problems = validate_anonymous_access(config, lambda *_args: (500, None))
        self.assertEqual(len(problems), 2)
        self.assertNotIn("synthetic-public-key", " ".join(problems))


if __name__ == "__main__":
    unittest.main()
