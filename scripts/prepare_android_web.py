#!/usr/bin/env python3
from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_SOURCE = ROOT / "_site"
DEFAULT_DESTINATION = ROOT / "_android_site"
TEXT_SUFFIXES = {".html", ".js", ".json", ".webmanifest"}
ROOT_RELATIVE_STRING = re.compile(r'(?P<quote>["\'\x60])(?P<value>/[^"\'\x60\r\n<>]*)(?P=quote)')
NATIVE_AUTH_BRIDGE_TAG = '<script src="/native_auth_bridge.js?v=20261004-1"></script>'


def route_map(site_root: Path) -> dict[str, str]:
    routes: dict[str, str] = {}
    for index_file in site_root.rglob("index.html"):
        relative_dir = index_file.parent.relative_to(site_root)
        if not relative_dir.parts:
            continue
        clean = "/" + relative_dir.as_posix().strip("/") + "/"
        explicit = clean + "index.html"
        routes[clean] = explicit
        routes[clean.rstrip("/")] = explicit
    return routes


def rewrite_path(value: str, routes: dict[str, str]) -> str:
    if not value.startswith("/") or value.startswith("//"):
        return value

    fragment = ""
    before_fragment = value
    if "#" in before_fragment:
        before_fragment, fragment_text = before_fragment.split("#", 1)
        fragment = "#" + fragment_text

    query = ""
    path = before_fragment
    if "?" in before_fragment:
        path, query_text = before_fragment.split("?", 1)
        query = "?" + rewrite_query(query_text, routes)

    mapped = routes.get(path, path)
    return mapped + query + fragment


def rewrite_query(query: str, routes: dict[str, str]) -> str:
    parts: list[str] = []
    for part in query.split("&"):
        if "=" not in part:
            parts.append(part)
            continue
        key, value = part.split("=", 1)
        decoded = unquote(value)
        if decoded.startswith("/") and not decoded.startswith("//"):
            rewritten = rewrite_path(decoded, routes)
            if rewritten != decoded and value == decoded:
                value = rewritten
        parts.append(key + "=" + value)
    return "&".join(parts)


def rewrite_text(content: str, routes: dict[str, str]) -> str:
    def replace(match: re.Match[str]) -> str:
        quote = match.group("quote")
        value = match.group("value")
        return quote + rewrite_path(value, routes) + quote

    return ROOT_RELATIVE_STRING.sub(replace, content)


def inject_native_auth_bridge(content: str) -> str:
    if NATIVE_AUTH_BRIDGE_TAG in content:
        return content
    if "</head>" not in content:
        return content
    return content.replace(
        "</head>",
        "  " + NATIVE_AUTH_BRIDGE_TAG + "\n</head>",
        1,
    )


def prepare_native_payment_page(content: str) -> str:
    replacements = {
        '<script src="https://sdk.mercadopago.com/js/v2"></script>': "",
        '<script src="/pagamento/subscription_checkout.js?v=20260929-1"></script>': "",
        "<h1>Pague com Pix ou cartão de débito</h1>": "<h1>Consulte suas mensalidades</h1>" ,
        "<p>O pagamento é processado pelo Mercado Pago.</p>":
            "<p>Veja mensalidades em aberto, vencimentos e situação da sua conta.</p>",
        "<span>Pagamento seguro</span>": "<span>Mensalidades</span>",
    }
    updated = content
    for old, new in replacements.items():
        updated = updated.replace(old, new)
    updated = updated.replace(
        '<div class="payment-security" aria-label="Informações de segurança">',
        '<div class="payment-security" aria-label="Informações de segurança" hidden>',
    )
    return updated


def prepare_android_web(source: Path, destination: Path) -> int:
    if not source.is_dir():
        raise SystemExit(f"Android web source does not exist: {source}")

    if destination.exists():
        shutil.rmtree(destination)
    shutil.copytree(source, destination)

    routes = route_map(destination)
    changed = 0
    for path in destination.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue

        content = path.read_text(encoding="utf-8")
        rewritten = rewrite_text(content, routes)
        if path.suffix.lower() == ".html":
            rewritten = inject_native_auth_bridge(rewritten)
            if path.relative_to(destination).as_posix() == "pagamento/index.html":
                rewritten = prepare_native_payment_page(rewritten)

        if rewritten == content:
            continue

        path.write_text(rewritten, encoding="utf-8")
        changed += 1

    return changed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare Capacitor assets with explicit local HTML routes."
    )
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--destination", type=Path, default=DEFAULT_DESTINATION)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    source = args.source if args.source.is_absolute() else ROOT / args.source
    destination = (
        args.destination if args.destination.is_absolute() else ROOT / args.destination
    )
    changed = prepare_android_web(source.resolve(), destination.resolve())
    print(f"Android web preparation: {changed} file(s) rewritten.")


if __name__ == "__main__":
    main()
