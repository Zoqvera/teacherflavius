#!/usr/bin/env python3
"""Read-only monitoring for suspended exercise portals and retired weekly views."""

from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from typing import Any, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit
from urllib.request import Request, urlopen

SITE_ORIGIN = "https://teacherflavius.com"
SUPABASE_ORIGIN = "https://wnigzpvgsbpjdxvjzugt.supabase.co"
SUSPENSION_MESSAGE = "Portal de Exercícios temporariamente indisponível"
SUSPENDED_PATH = "/exercicios-diarios"
LEGACY_PAGES = (
    "/exercicios-diarios/",
    "/exercicios.diarios.html",
    "/exercicios_diarios.html",
)
PUBLISHED_PATHS = LEGACY_PAGES + (
    "/area-do-estudante/",
    "/area_do_estudante.html",
    "/area_do_estudante.js",
    "/minha-semana/",
    "/professor/",
    "/professor.html",
    "/professor_home.js",
    "/professor/professor_icons.js",
    "/planos-semanais/",
    "/curso-de-ingles-online/",
    "/service-worker.js",
    "/supabase_config.js",
)


class AnchorReader(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        self.links.extend(value for name, value in attrs if name == "href" and value)


def points_to_site_path(href: str, expected_path: str) -> bool:
    """Resolve local navigation targets without trusting external hosts."""
    parsed = urlsplit(urljoin(SITE_ORIGIN + "/", href))
    return (
        parsed.scheme == "https"
        and parsed.netloc == "teacherflavius.com"
        and parsed.path.rstrip("/") == expected_path.rstrip("/")
    )


def points_to_suspended_portal(href: str) -> bool:
    return points_to_site_path(href, SUSPENDED_PATH)


def validate_published_pages(pages: Mapping[str, str]) -> list[str]:
    """Check visible contracts without authenticating or modifying student data."""
    problems: list[str] = []

    for path in LEGACY_PAGES:
        document = pages.get(path, "")
        if SUSPENSION_MESSAGE not in document:
            problems.append(path + ": aviso de suspensão ausente")
        if "google.com/forms" in document.lower():
            problems.append(path + ": formulário externo indevidamente exposto")
        if "get_public_teacher_exercises" in document:
            problems.append(path + ": catálogo antigo voltou a ser consultado")

    student_shell = pages.get("/area-do-estudante/", "")
    shell_cache_version = re.search(
        r'sourcePage\s*\+\s*"\?v=(20\d{6})-[A-Za-z0-9-]+"',
        student_shell
    )
    if (
        "cache: 'no-store'" not in student_shell
        or not shell_cache_version
        or shell_cache_version.group(1) < "20261015"
    ):
        problems.append("Área do Estudante: atualização de cache não preservada")

    student_page = pages.get("/area_do_estudante.html", "")
    links = AnchorReader()
    links.feed(student_page)
    if any(points_to_suspended_portal(href) for href in links.links):
        problems.append("Área do Estudante: link para o portal antigo reapareceu")
    if any(points_to_site_path(href, "/minha-semana/") for href in links.links):
        problems.append("Área do Estudante: card Minha Semana descontinuado reapareceu")
    student_version = re.search(
        r'area_do_estudante\.js\?v=(20\d{6})-[A-Za-z0-9-]+',
        student_page,
    )
    if not student_version or student_version.group(1) < "20261016":
        problems.append("Área do Estudante: versão de script desatualizada")

    student_script = pages.get("/area_do_estudante.js", "")
    if "removeUnavailableStudentCards();" not in student_script:
        problems.append("Área do Estudante: proteção dos cards indisponíveis ausente")
    if '"/minha-semana"' not in student_script:
        problems.append("Área do Estudante: remoção de Minha Semana ausente")
    if any(value in student_script for value in (
        "get_public_teacher_exercises",
        "daily_exercise_completion",
        "showOverdueActivityIfNeeded",
    )):
        problems.append("Área do Estudante: consulta ou alerta antigo reintroduzido")

    week_shell = pages.get("/minha-semana/", "")
    if (
        "Minha Semana descontinuada" not in week_shell
        or 'href="/area-do-estudante/"' not in week_shell
        or "minha_semana_dashboard.js" in week_shell
    ):
        problems.append("Minha Semana: a página descontinuada foi reativada ou perdeu o aviso")

    professor_shell = pages.get("/professor/", "")
    if (
        "/professor.html" not in professor_shell
        or "cache: 'no-store'" not in professor_shell
    ):
        problems.append("Área do Professor: carregamento sem cache não preservado")

    professor_page = pages.get("/professor.html", "")
    professor_links = AnchorReader()
    professor_links.feed(professor_page)
    if any(
        points_to_site_path(href, "/planos-semanais/")
        for href in professor_links.links
    ):
        problems.append("Área do Professor: card Planos Semanais reapareceu")

    professor_version = re.search(
        r'professor_home\.js\?v=(20\d{6})-[A-Za-z0-9-]+',
        professor_page,
    )
    icon_version = re.search(
        r'professor_icons\.js\?v=(20\d{6})-[A-Za-z0-9-]+',
        professor_page,
    )
    if (
        not professor_version
        or professor_version.group(1) < "20261016"
        or not icon_version
        or icon_version.group(1) < "20261016"
    ):
        problems.append("Área do Professor: versões de scripts anteriores à descontinuação")

    professor_script = pages.get("/professor_home.js", "")
    if (
        'RETIRED_REPORT_CARD_ID = "planos-semanais"' not in professor_script
        or "removeRetiredProfessorReportCard();" not in professor_script
    ):
        problems.append("Área do Professor: proteção contra card antigo ausente")

    professor_icons = pages.get("/professor/professor_icons.js", "")
    if "'planos-semanais':" in professor_icons:
        problems.append("Área do Professor: ícone do relatório descontinuado reapareceu")

    report_page = pages.get("/planos-semanais/", "")
    if (
        "Planos Semanais descontinuado" not in report_page
        or 'href="/professor/"' not in report_page
        or "planos_semanais_dashboard.js" in report_page
        or "supabase_config.js" in report_page
        or 'id="studentList"' in report_page
    ):
        problems.append("Planos Semanais: relatório descontinuado reativado ou aviso ausente")

    marketing = pages.get("/curso-de-ingles-online/", "")
    if marketing.count("Portal de Exercícios") < 2:
        problems.append("Apresentação do curso: menções autorizadas ao portal alteradas")

    service_worker = pages.get("/service-worker.js", "")
    if 'if (!isInstallAsset(event.request)) return;' not in service_worker:
        problems.append("PWA: interceptação de cache de páginas precisa de revisão")

    return problems


def public_database_config(config_script: str) -> tuple[str, str]:
    url_match = re.search(r'\burl:\s*"([^"]+)"', config_script)
    key_match = re.search(r'\banonKey:\s*"([^"]+)"', config_script)
    if not url_match or not key_match or url_match.group(1) != SUPABASE_ORIGIN:
        raise ValueError("Configuração pública do Supabase não reconhecida")
    return url_match.group(1), key_match.group(1)


def validate_anonymous_access(
    config_script: str,
    request_json: Any,
) -> list[str]:
    """Reject exposed legacy rows via the anonymous Data API only."""
    origin, public_key = public_database_config(config_script)
    probes = (
        ("tabela", "GET", origin + "/rest/v1/teacher_exercises?select=id&limit=1"),
        ("função", "POST", origin + "/rest/v1/rpc/get_public_teacher_exercises"),
    )
    problems: list[str] = []

    for label, method, url in probes:
        status, payload = request_json(method, url, public_key)
        if status in (401, 403, 404):
            continue
        if status != 200 or not isinstance(payload, list):
            problems.append("Supabase: resposta inesperada da " + label)
        elif payload:
            problems.append("Supabase: acesso anônimo expôs dados da " + label)

    return problems


def fetch_site_page(path: str) -> str:
    request = Request(
        SITE_ORIGIN + path,
        headers={
            "User-Agent": "TeacherFlavius-suspension-monitor/1.0",
            "Cache-Control": "no-cache",
        },
    )
    with urlopen(request, timeout=20) as response:
        if response.status != 200:
            raise RuntimeError("HTTP " + str(response.status))
        return response.read().decode("utf-8")


def request_public_api(method: str, url: str, api_key: str) -> tuple[int, Any]:
    request = Request(
        url,
        data=b"{}" if method == "POST" else None,
        method=method,
        headers={
            "apikey": api_key,
            "Authorization": "Bearer " + api_key,
            "Content-Type": "application/json",
        },
    )
    try:
        with urlopen(request, timeout=20) as response:
            return response.status, json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        return error.code, None


def main() -> int:
    pages: dict[str, str] = {}
    failures: list[str] = []

    for path in PUBLISHED_PATHS:
        try:
            pages[path] = fetch_site_page(path)
        except (URLError, HTTPError, TimeoutError, OSError, ValueError, RuntimeError) as error:
            failures.append(path + ": falha na verificação HTTP (" + type(error).__name__ + ")")

    failures.extend(validate_published_pages(pages))

    if "/supabase_config.js" in pages:
        try:
            failures.extend(
                validate_anonymous_access(
                    pages["/supabase_config.js"],
                    request_public_api,
                )
            )
        except (URLError, HTTPError, TimeoutError, OSError, ValueError, RuntimeError) as error:
            failures.append("Supabase: falha na consulta anônima (" + type(error).__name__ + ")")

    if failures:
        for failure in failures:
            print("FAIL: " + failure, file=sys.stderr)
        return 1

    print(
        "PASS: portal suspenso, Área do Estudante e PWA protegidos, "
        "Minha Semana e Planos Semanais descontinuados, comunicação pública preservada, "
        "acesso anônimo ao catálogo negado."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
