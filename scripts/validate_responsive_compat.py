#!/usr/bin/env python3
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PUBLISH = ROOT / "_site"
CSS = ROOT / "responsive_compat.css"


def has_viewport(html: str) -> bool:
    lower = html.lower()
    return 'name="viewport"' in lower or "name='viewport'" in lower


def main() -> None:
    errors: list[str] = []

    if not CSS.is_file():
        errors.append("responsive_compat.css is missing")
    else:
        css = CSS.read_text(encoding="utf-8")
        required_css = {
            "iOS text scaling": "-webkit-text-size-adjust: 100%",
            "horizontal overflow fallback": "overflow-x: hidden",
            "modern overflow clipping": "overflow-x: clip",
            "safe-area support": "safe-area-inset-bottom",
            "touch interaction optimization": "touch-action: manipulation",
            "iOS form zoom prevention": "font-size: 16px !important",
            "Safari backdrop-filter fallback": "-webkit-backdrop-filter: blur(6px)",
            "legacy viewport-height fallback": "max-height: min(82vh, 720px)",
            "dynamic viewport height": "max-height: min(82dvh, 720px)",
            "touch hover handling": "@media (hover: none) and (pointer: coarse)",
        }
        for label, token in required_css.items():
            if token not in css:
                errors.append(f"responsive_compat.css missing {label}: {token}")

        hidden_pos = css.find("overflow-x: hidden")
        clip_pos = css.find("overflow-x: clip")
        if hidden_pos < 0 or clip_pos < 0 or hidden_pos > clip_pos:
            errors.append("overflow-x fallback must precede overflow-x: clip")

        vh_pos = css.find("max-height: min(82vh, 720px)")
        dvh_pos = css.find("max-height: min(82dvh, 720px)")
        if vh_pos < 0 or dvh_pos < 0 or vh_pos > dvh_pos:
            errors.append("vh fallback must precede dvh enhancement")

    if not PUBLISH.is_dir():
        errors.append("_site is missing; run scripts/build_static_site.py first")
    else:
        html_files = sorted(PUBLISH.rglob("*.html")) + sorted(PUBLISH.rglob("*.htm"))
        checked = 0
        for path in html_files:
            html = path.read_text(encoding="utf-8")
            lower = html.lower()
            if "</head>" not in lower:
                continue
            checked += 1
            relative = path.relative_to(PUBLISH)
            if not has_viewport(html):
                errors.append(f"{relative}: missing responsive viewport metadata")
            if "/responsive_compat.css" not in lower:
                errors.append(f"{relative}: missing responsive compatibility stylesheet")

        if checked == 0:
            errors.append("no deployable HTML documents with <head> were checked")

        for critical in [
            "index.html",
            "login.html",
            "complete-cadastro.html",
            "mensalidades.html",
            "flashcards.html",
            "pagamento/index.html",
            "curso-de-ingles-online/index.html",
        ]:
            path = PUBLISH / critical
            if not path.is_file():
                errors.append(f"critical responsive flow missing from build: {critical}")

    if errors:
        print("Responsive compatibility validation failed:")
        for error in errors:
            print(f"- {error}")
        raise SystemExit(1)

    print("Responsive compatibility validation passed for Android/iOS and Chromium/WebKit/Gecko baselines.")


if __name__ == "__main__":
    main()
