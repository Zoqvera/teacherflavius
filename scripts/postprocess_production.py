#!/usr/bin/env python3
from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"

COURSE_SCHEMA_OLD = '''        "description":"Professor de inglês com mais de 15 anos de experiência, Doutor e Mestre em Linguística, Bacharel em Tradução e certificado CELTA.",
        "sameAs":["https://www.instagram.com/teacher.flavius"]'''
COURSE_SCHEMA_NEW = '''        "description":"Professor de inglês, Doutor e Mestre em Linguística, Bacharel em Tradução, certificado CELTA e pesquisador na interface entre linguagem, tradução e tecnologias de inteligência artificial.",
        "sameAs":["https://www.instagram.com/teacher.flavius","https://orcid.org/0000-0002-8972-5870"],
        "knowsAbout":["Língua inglesa","Linguística","Tradução","Speech-to-speech translation","Machine interpreting","Machine translation"]'''

COURSE_TEACHER_OLD = '''          <p>Professor de inglês com mais de 15 anos de experiência e formação acadêmica em linguagem. O curso combina experiência docente com uma proposta simples: aulas ao vivo, turmas reduzidas, prática e continuidade de estudos.</p>
          <ul class="credentials">
            <li>Doutor em Linguística</li>
            <li>Mestre em Linguística</li>
            <li>Bacharel em Tradução</li>
            <li>Certificado CELTA</li>
            <li>Mais de 15 anos de experiência</li>
          </ul>'''
COURSE_TEACHER_NEW = '''          <p>Professor de inglês com mais de 15 anos de experiência e formação acadêmica em linguagem. Além da docência, Flávio de Sousa Freitas desenvolve pesquisa na interface entre Linguística, Tradução e inteligência artificial, com produção científica sobre <em>speech-to-speech translation</em>, interpretação automática e tradução automática. O curso combina essa formação acadêmica com uma proposta prática: aulas ao vivo, turmas reduzidas e acompanhamento contínuo.</p>
          <ul class="credentials">
            <li>Doutor em Linguística</li>
            <li>Mestre em Linguística</li>
            <li>Bacharel em Tradução</li>
            <li>Certificado CELTA</li>
            <li data-authority-credential="Pesquisador de <em>speech-to-speech translation</em> e tecnologias da linguagem">Pesquisador de <em>speech-to-speech translation</em> e tecnologias da linguagem</li>
            <li data-authority-credential="Publicações científicas no Brasil e no exterior">Publicações científicas no Brasil e no exterior</li>
            <li>Mais de 15 anos de experiência</li>
          </ul>'''

COURSE_AUTHORITY_BLOCK = '''      <div id="academicAuthorityProof" class="shell authority-proof" aria-labelledby="research-evidence-title">
        <div class="section-head">
          <p class="eyebrow">Pesquisa e publicações</p>
          <h2 id="research-evidence-title">Formação acadêmica respaldada por produção científica.</h2>
          <p>A trajetória de pesquisa do professor inclui trabalhos publicados por universidades e periódicos acadêmicos sobre linguagem, tradução e tecnologias de inteligência artificial.</p>
        </div>
        <div class="authority-proof-grid">
          <article class="authority-proof-card">
            <h3>Speech-to-speech translation — USP</h3>
            <p>Artigo publicado em 2017 na revista <em>TradTerm</em>, da Universidade de São Paulo, sobre conceitos e arquitetura de sistemas de tradução automática de fala.</p>
            <p><a class="authority-proof-link" href="https://revistas.usp.br/tradterm/pt_BR/article/view/134416" target="_blank" rel="noopener noreferrer">Ver publicação na USP</a></p>
          </article>
          <article class="authority-proof-card">
            <h3>Pesquisa de mestrado — UFU</h3>
            <p>Dissertação em Estudos Linguísticos sobre aplicativos móveis de interpretação automática e a experiência de usuários brasileiros, disponível no Repositório Institucional da UFU.</p>
            <p><a class="authority-proof-link" href="https://repositorio.ufu.br/handle/123456789/35038" target="_blank" rel="noopener noreferrer">Ver pesquisa na UFU</a></p>
          </article>
          <article class="authority-proof-card">
            <h3>Produção internacional — Diacrítica</h3>
            <p>Coautor de estudo sobre a evolução da pesquisa em <em>machine interpreting</em>, publicado na revista <em>Diacrítica</em>, do Centro de Estudos Humanísticos da Universidade do Minho.</p>
            <p><a class="authority-proof-link" href="https://doaj.org/article/09e6d2630519401db695819da13ef6e2" target="_blank" rel="noopener noreferrer">Ver publicação internacional</a></p>
          </article>
          <article class="authority-proof-card">
            <h3>Tradução automática — IBICT</h3>
            <p>Coautor de estudo cienciométrico sobre desenvolvimentos tecnológicos em tradução automática publicado na revista <em>Ciência da Informação</em>.</p>
            <p><a class="authority-proof-link" href="https://revista.ibict.br/ciinf/article/view/5542" target="_blank" rel="noopener noreferrer">Ver publicação no IBICT</a></p>
          </article>
        </div>
        <p class="authority-book">Flávio também é coautor do livro <strong>Tradução e interpretação automáticas: origens</strong>, publicado pela Editora CRV em 2020. <a href="https://doi.org/10.24824/978854443937.1" target="_blank" rel="noopener noreferrer">Consultar DOI do livro</a>.</p>
      </div>
'''


def current_commit_sha() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def update_homepage() -> None:
    index = PUBLISH / "index.html"
    if not index.is_file():
        raise SystemExit("Static build missing _site/index.html")

    html = index.read_text(encoding="utf-8")
    html = re.sub(
        r'<section\s+class="section"\s+aria-labelledby="benefits-title">',
        '<section class="section" aria-label="Como funcionam as aulas">',
        html,
        count=1,
    )
    html = re.sub(
        r'\s*<h2\s+id="benefits-title">Inglês online com professor, prática e acompanhamento\.</h2>\s*',
        "\n",
        html,
        count=1,
    )
    index.write_text(html, encoding="utf-8")


def update_course_authority() -> None:
    index = PUBLISH / "curso-de-ingles-online" / "index.html"
    if not index.is_file():
        raise SystemExit("Static build missing _site/curso-de-ingles-online/index.html")

    html = index.read_text(encoding="utf-8")

    if COURSE_SCHEMA_NEW not in html:
        if COURSE_SCHEMA_OLD not in html:
            raise SystemExit("Course Person schema anchor not found")
        html = html.replace(COURSE_SCHEMA_OLD, COURSE_SCHEMA_NEW, 1)

    if COURSE_TEACHER_NEW not in html:
        if COURSE_TEACHER_OLD not in html:
            raise SystemExit("Course teacher authority anchor not found")
        html = html.replace(COURSE_TEACHER_OLD, COURSE_TEACHER_NEW, 1)

    if 'id="academicAuthorityProof"' not in html:
        insertion_anchor = '''      </div>
    </section>

    <section class="section" aria-labelledby="difference-title">'''
        if insertion_anchor not in html:
            raise SystemExit("Course authority insertion anchor not found")
        html = html.replace(
            insertion_anchor,
            "      </div>\n" + COURSE_AUTHORITY_BLOCK + '''    </section>

    <section class="section" aria-labelledby="difference-title">''',
            1,
        )

    index.write_text(html, encoding="utf-8")


def write_health_check() -> None:
    payload = {
        "status": "ok",
        "service": "teacherflavius.com",
        "commit": current_commit_sha(),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    (PUBLISH / "health.json").write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    if not PUBLISH.is_dir():
        raise SystemExit("Run scripts/build_static_site.py before production post-processing")
    update_homepage()
    update_course_authority()
    write_health_check()
    print("Production post-processing ready: homepage cleanup + course authority + health.json")


if __name__ == "__main__":
    main()
