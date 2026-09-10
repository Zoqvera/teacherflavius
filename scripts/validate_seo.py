#!/usr/bin/env python3
"""Validate technical SEO invariants for every canonical public URL."""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlparse

SITE_ORIGIN = "https://teacherflavius.com"
PRIVATE_PREFIXES = (
    "/login/",
    "/cadastro/",
    "/complete-cadastro/",
    "/area-do-estudante/",
    "/professor/",
    "/perfil/",
    "/minha-turma/",
    "/frequencia/",
    "/reposicoes/",
    "/mensalidades/",
    "/turmas/",
    "/flashcards/",
    "/meu-progresso/",
    "/minha-semana/",
    "/roteiro-de-estudos/",
    "/pagamento/",
)
LEGACY_REDIRECTS = (
    "/quero_conhecer.html",
    "/quero_conhecer",
    "/quero_conhecer/",
    "/quero-conhecer",
    "/quero-conhecer/",
)
COURSE_PATH = "/curso-de-ingles-online/"


class DocumentParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title_depth = 0
        self.title_parts: list[str] = []
        self.heading_levels: list[int] = []
        self.meta: dict[str, str] = {}
        self.og: dict[str, str] = {}
        self.links: list[dict[str, str]] = []
        self.anchors: list[str] = []
        self.json_ld: list[str] = []
        self._json_ld_depth = 0
        self._json_ld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key.lower(): (value or "") for key, value in attrs}
        tag = tag.lower()

        if tag == "title":
            self.title_depth += 1
        elif tag in {"h1", "h2", "h3"}:
            self.heading_levels.append(int(tag[1]))
        elif tag == "meta":
            name = attrs_dict.get("name", "").lower()
            prop = attrs_dict.get("property", "").lower()
            content = attrs_dict.get("content", "").strip()
            if name:
                self.meta[name] = content
            if prop.startswith("og:"):
                self.og[prop] = content
        elif tag == "link":
            self.links.append(attrs_dict)
        elif tag == "a":
            href = attrs_dict.get("href", "").strip()
            if href:
                self.anchors.append(href)
        elif tag == "script" and attrs_dict.get("type", "").lower() == "application/ld+json":
            self._json_ld_depth += 1
            self._json_ld_parts = []

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag == "title" and self.title_depth:
            self.title_depth -= 1
        elif tag == "script" and self._json_ld_depth:
            self._json_ld_depth -= 1
            text = "".join(self._json_ld_parts).strip()
            if text:
                self.json_ld.append(text)
            self._json_ld_parts = []

    def handle_data(self, data: str) -> None:
        if self.title_depth:
            self.title_parts.append(data)
        if self._json_ld_depth:
            self._json_ld_parts.append(data)

    @property
    def title(self) -> str:
        return " ".join(part.strip() for part in self.title_parts if part.strip()).strip()

    @property
    def h1_count(self) -> int:
        return self.heading_levels.count(1)

    def canonical(self) -> str:
        for link in self.links:
            rel_tokens = {token.lower() for token in link.get("rel", "").split()}
            if "canonical" in rel_tokens:
                return link.get("href", "").strip()
        return ""


def parse_html(path: Path) -> DocumentParser:
    parser = DocumentParser()
    parser.feed(path.read_text(encoding="utf-8"))
    return parser


def sitemap_urls(site_root: Path, errors: list[str]) -> list[str]:
    sitemap_path = site_root / "sitemap.xml"
    if not sitemap_path.is_file():
        errors.append("Arquivo obrigatório ausente: sitemap.xml")
        return []

    try:
        root = ET.parse(sitemap_path).getroot()
    except ET.ParseError as exc:
        errors.append(f"sitemap.xml inválido: {exc}")
        return []

    namespace = "{http://www.sitemaps.org/schemas/sitemap/0.9}"
    urls = [(node.text or "").strip() for node in root.findall(f".//{namespace}loc")]
    if not urls:
        errors.append("sitemap.xml precisa conter ao menos uma URL")
    if len(urls) != len(set(urls)):
        errors.append("sitemap.xml contém URLs duplicadas")
    return urls


def page_path_for_url(site_root: Path, url: str) -> Path:
    path = urlparse(url).path.strip("/")
    return site_root / ("index.html" if not path else str(Path(path) / "index.html"))


def schema_types(document: DocumentParser, label: str, errors: list[str]) -> set[str]:
    found: set[str] = set()
    valid_blocks = 0
    for block in document.json_ld:
        try:
            data = json.loads(block)
        except json.JSONDecodeError as exc:
            errors.append(f"{label}: JSON-LD inválido: {exc}")
            continue
        valid_blocks += 1
        nodes = data.get("@graph", []) if isinstance(data, dict) else []
        if isinstance(nodes, dict):
            nodes = [nodes]
        if not nodes and isinstance(data, dict):
            nodes = [data]
        for node in nodes:
            if not isinstance(node, dict):
                continue
            node_type = node.get("@type")
            if isinstance(node_type, str):
                found.add(node_type)
            elif isinstance(node_type, list):
                found.update(value for value in node_type if isinstance(value, str))
    if valid_blocks == 0:
        errors.append(f"{label}: precisa de pelo menos um bloco JSON-LD válido")
    return found


def expected_schema_types(path: str) -> set[str]:
    if path == "/":
        return {"WebSite", "Course"}
    if path == COURSE_PATH:
        return {"Course"}
    if path == "/sobre/":
        return {"AboutPage", "Person"}
    if path == "/recursos/":
        return {"CollectionPage"}
    if path.startswith("/recursos/"):
        return {"Article"}
    return set()


def validate_heading_hierarchy(document: DocumentParser, label: str, errors: list[str]) -> None:
    if document.h1_count != 1:
        errors.append(f"{label}: deve ter exatamente um H1; encontrado(s): {document.h1_count}")
        return
    if not document.heading_levels or document.heading_levels[0] != 1:
        errors.append(f"{label}: o primeiro heading deve ser H1")
    previous = document.heading_levels[0] if document.heading_levels else 1
    for level in document.heading_levels[1:]:
        if level > previous + 1:
            errors.append(f"{label}: salto de hierarquia H{previous} → H{level}")
            break
        previous = level


def validate_public_page(site_root: Path, url: str, errors: list[str]) -> None:
    parsed_url = urlparse(url)
    label = parsed_url.path or "/"
    if not url.startswith(f"{SITE_ORIGIN}/"):
        errors.append(f"URL do sitemap fora do domínio canônico: {url}")
        return
    if parsed_url.query or parsed_url.fragment:
        errors.append(f"URL do sitemap não deve conter query/fragmento: {url}")
    if parsed_url.path.endswith(".html"):
        errors.append(f"URL legada .html encontrada no sitemap: {url}")
    if any(parsed_url.path.startswith(prefix) for prefix in PRIVATE_PREFIXES):
        errors.append(f"URL privada encontrada no sitemap: {url}")

    path = page_path_for_url(site_root, url)
    if not path.is_file():
        errors.append(f"{label}: arquivo público não encontrado em {path.relative_to(site_root)}")
        return

    document = parse_html(path)
    title = document.title
    description = document.meta.get("description", "")
    robots = document.meta.get("robots", "").lower()

    if not 10 <= len(title) <= 80:
        errors.append(f"{label}: <title> ausente ou com tamanho incomum ({len(title)} caracteres)")
    if not 50 <= len(description) <= 200:
        errors.append(f"{label}: meta description ausente ou com tamanho incomum ({len(description)} caracteres)")
    if "noindex" in robots:
        errors.append(f"{label}: URL pública do sitemap não pode conter noindex")
    if document.canonical() != url:
        errors.append(f"{label}: canonical deve ser {url}; encontrado: {document.canonical() or 'ausente'}")

    validate_heading_hierarchy(document, label, errors)

    required_og = (
        "og:type",
        "og:locale",
        "og:site_name",
        "og:title",
        "og:description",
        "og:url",
        "og:image",
        "og:image:width",
        "og:image:height",
        "og:image:alt",
    )
    for key in required_og:
        if not document.og.get(key):
            errors.append(f"{label}: Open Graph obrigatório ausente: {key}")
    if document.og.get("og:url") != url:
        errors.append(f"{label}: og:url deve corresponder ao canonical")
    if document.og.get("og:image:width") != "1200" or document.og.get("og:image:height") != "630":
        errors.append(f"{label}: imagem Open Graph deve declarar 1200x630")
    if urlparse(document.og.get("og:image", "")).scheme != "https":
        errors.append(f"{label}: og:image deve usar URL HTTPS absoluta")

    for key in ("twitter:card", "twitter:title", "twitter:description", "twitter:image"):
        if not document.meta.get(key):
            errors.append(f"{label}: Twitter Card obrigatório ausente: {key}")
    if document.meta.get("twitter:card") != "summary_large_image":
        errors.append(f"{label}: twitter:card deve ser summary_large_image")

    found_types = schema_types(document, label, errors)
    for expected in expected_schema_types(parsed_url.path):
        if expected not in found_types:
            errors.append(f"{label}: Schema.org deve incluir {expected}")

    legacy_links = []
    for href in document.anchors:
        parsed = urlparse(href)
        if parsed.scheme or parsed.netloc:
            continue
        if parsed.path.endswith(".html"):
            legacy_links.append(href)
    if legacy_links:
        errors.append(f"{label}: links internos legados .html: {', '.join(sorted(set(legacy_links)))}")


def validate_robots(site_root: Path, errors: list[str]) -> None:
    path = site_root / "robots.txt"
    if not path.is_file():
        errors.append("Arquivo obrigatório ausente: robots.txt")
        return
    text = path.read_text(encoding="utf-8")
    if re.search(r"(?im)^User-agent:\s*\*$", text) is None:
        errors.append("robots.txt precisa declarar User-agent: *")
    if re.search(rf"(?im)^Sitemap:\s*{re.escape(SITE_ORIGIN)}/sitemap\.xml\s*$", text) is None:
        errors.append("robots.txt precisa apontar para o sitemap canônico")
    for prefix in ("/login/", "/area-do-estudante/", "/professor/", "/mensalidades/"):
        if re.search(rf"(?im)^Disallow:\s*{re.escape(prefix)}\s*$", text) is None:
            errors.append(f"robots.txt deve bloquear crawling de {prefix}")


def validate_404(site_root: Path, errors: list[str]) -> None:
    path = site_root / "404.html"
    if not path.is_file():
        errors.append("Arquivo obrigatório ausente: 404.html")
        return
    document = parse_html(path)
    if document.h1_count != 1:
        errors.append(f"404.html deve ter exatamente um H1; encontrado(s): {document.h1_count}")
    if "noindex" not in document.meta.get("robots", "").lower():
        errors.append("404.html precisa conter meta robots noindex")
    if document.canonical():
        errors.append("404.html não deve canonicalizar para uma página válida")
    paths = {urlparse(href).path for href in document.anchors}
    if "/" not in paths:
        errors.append("404.html precisa oferecer link para a homepage")
    if COURSE_PATH not in paths:
        errors.append(f"404.html precisa oferecer link para {COURSE_PATH}")
    if "/quero-conhecer/" in paths or "/quero_conhecer.html" in paths:
        errors.append("404.html não deve apontar para rota comercial legada")


def validate_redirects(site_root: Path, errors: list[str]) -> None:
    path = site_root / "_redirects"
    if not path.is_file():
        errors.append("Arquivo obrigatório ausente: _redirects")
        return
    rules: dict[str, tuple[str, str]] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 3:
            rules[parts[0]] = (parts[1], parts[2])
    for legacy in LEGACY_REDIRECTS:
        destination, status = rules.get(legacy, ("", ""))
        if destination != COURSE_PATH or status != "301":
            errors.append(f"_redirects: {legacy} deve redirecionar 301 para {COURSE_PATH}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--site-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="Diretório que contém o artefato estático a validar.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    site_root = args.site_root.resolve()
    errors: list[str] = []

    urls = sitemap_urls(site_root, errors)
    if f"{SITE_ORIGIN}/" not in urls:
        errors.append("sitemap.xml precisa conter a homepage canônica")
    for url in urls:
        validate_public_page(site_root, url, errors)

    validate_robots(site_root, errors)
    validate_404(site_root, errors)
    validate_redirects(site_root, errors)

    if errors:
        print("Technical SEO audit: FAILED")
        for error in errors:
            print(f"::error::{error}")
        return 1

    print("Technical SEO audit: OK")
    print(f"Validated {len(urls)} sitemap URLs plus robots.txt, redirects and 404.html.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
