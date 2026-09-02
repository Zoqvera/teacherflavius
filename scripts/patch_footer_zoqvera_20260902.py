from pathlib import Path

path = Path("site_footer_core.js")
text = path.read_text(encoding="utf-8")

old = "      '    <p>&copy; <span data-tf-footer-year></span> Teacher Flávio. Todos os direitos reservados.<br>Flávio de Sousa Freitas · Bacharel em Tradução, Mestre e Doutor em Linguística.</p>',"
new = "      '    <p>&copy; <span data-tf-footer-year></span> Teacher Flávio. Todos os direitos reservados.<br>Flávio de Sousa Freitas · Bacharel em Tradução, Mestre e Doutor em Linguística.<br>Desenvolvido por <a href=\"https://zoqvera.com\" target=\"_blank\" rel=\"noopener noreferrer\">Zoqvera</a>.</p>',"

if new in text:
    raise SystemExit(0)
if old not in text:
    raise SystemExit("Footer copyright anchor not found")

path.write_text(text.replace(old, new, 1), encoding="utf-8")
