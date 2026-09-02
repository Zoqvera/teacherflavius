#!/usr/bin/env python3
"""Lightweight static accessibility baseline for key Teacher Flávio flows."""

from __future__ import annotations

import sys
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    Path("index.html"),
    Path("curso-de-ingles-online/index.html"),
    Path("login.html"),
    Path("complete-cadastro.html"),
    Path("pagamento/index.html"),
]
MAIN_REQUIRED = {
    Path("index.html"),
    Path("curso-de-ingles-online/index.html"),
    Path("pagamento/index.html"),
}


def is_fully_hidden_iframe(data: dict[str, str]) -> bool:
    style = data.get("style", "").replace(" ", "").lower()
    is_zero_sized = data.get("width") == "0" and data.get("height") == "0"
    is_hidden_by_style = "display:none" in style and "visibility:hidden" in style
    return data.get("aria-hidden", "").lower() == "true" or (is_zero_sized and is_hidden_by_style)


class AuditParser(HTMLParser):
    def __init__(self, path: Path) -> None:
        super().__init__(convert_charrefs=True)
        self.path = path
        self.errors: list[str] = []
        self.labels_for: set[str] = set()
        self.controls: list[tuple[str, dict[str, str], int]] = []
        self.buttons: list[dict[str, object]] = []
        self._button_stack: list[int] = []
        self.html_lang = ""
        self.main_count = 0

    @staticmethod
    def attrs_dict(attrs: list[tuple[str, str | None]]) -> dict[str, str]:
        return {key: (value or "") for key, value in attrs}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = self.attrs_dict(attrs)
        line = self.getpos()[0]

        if tag == "html":
            self.html_lang = data.get("lang", "").strip()
        if tag == "main" or data.get("role") == "main":
            self.main_count += 1
        if tag == "label" and data.get("for"):
            self.labels_for.add(data["for"])
        if tag in {"input", "select", "textarea"}:
            input_type = data.get("type", "text").lower()
            if tag == "input" and input_type in {"hidden", "submit", "button", "reset", "image"}:
                return
            self.controls.append((tag, data, line))
        if tag == "img" and "alt" not in data:
            self.errors.append(f"L{line}: <img> sem atributo alt")
        if tag == "iframe" and not is_fully_hidden_iframe(data):
            has_accessible_name = data.get("title") or data.get("aria-label") or data.get("aria-labelledby")
            if not has_accessible_name:
                self.errors.append(f"L{line}: <iframe> sem título acessível")
        tabindex = data.get("tabindex", "").strip()
        if tabindex.lstrip("+").isdigit() and int(tabindex) > 0:
            self.errors.append(f"L{line}: tabindex positivo ({tabindex}) não é permitido")
        if tag == "button":
            self.buttons.append({"data": data, "line": line, "text": ""})
            self._button_stack.append(len(self.buttons) - 1)

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._button_stack:
            self._button_stack.pop()

    def handle_data(self, data: str) -> None:
        if self._button_stack:
            index = self._button_stack[-1]
            self.buttons[index]["text"] = str(self.buttons[index]["text"]) + data

    def finalize(self, require_main: bool) -> list[str]:
        if not self.html_lang:
            self.errors.append("<html> sem atributo lang")
        if require_main and self.main_count != 1:
            self.errors.append(f"esperado exatamente 1 landmark main; encontrado(s): {self.main_count}")

        for tag, data, line in self.controls:
            control_id = data.get("id", "")
            has_name = bool(
                data.get("aria-label")
                or data.get("aria-labelledby")
                or (control_id and control_id in self.labels_for)
            )
            if not has_name:
                self.errors.append(f"L{line}: <{tag}> sem label/aria-label/aria-labelledby")

        for button in self.buttons:
            data = button["data"]
            assert isinstance(data, dict)
            text = " ".join(str(button["text"]).split())
            if not (text or data.get("aria-label") or data.get("aria-labelledby") or data.get("title")):
                self.errors.append(f"L{button['line']}: <button> sem nome acessível")
        return self.errors


def audit(path: Path) -> list[str]:
    parser = AuditParser(path)
    parser.feed(path.read_text(encoding="utf-8"))
    return parser.finalize(path.relative_to(ROOT) in MAIN_REQUIRED)


def main() -> int:
    failures = 0
    for relative in TARGETS:
        path = ROOT / relative
        if not path.exists():
            print(f"[FAIL] {relative}: arquivo não encontrado")
            failures += 1
            continue
        errors = audit(path)
        if errors:
            failures += len(errors)
            print(f"[FAIL] {relative}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"[OK]   {relative}")

    if failures:
        print(f"\nAccessibility baseline: {failures} problema(s) encontrado(s).")
        return 1
    print("\nAccessibility baseline: OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
