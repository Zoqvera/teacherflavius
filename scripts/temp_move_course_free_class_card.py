from pathlib import Path

COURSE_PATH = Path("curso-de-ingles-online/index.html")
CARD_MARKER = '    <section class="course-free-class-section" aria-labelledby="course-free-class-title">'
HOW_MARKER = '    <section id="como-funciona" class="section" aria-labelledby="how-title">'
INCLUDED_MARKER = '    <section class="section alt" aria-labelledby="included-title">'
SECTION_END = '    </section>\n\n'


def move_card() -> None:
    html = COURSE_PATH.read_text(encoding="utf-8")

    card_start = html.find(CARD_MARKER)
    how_start = html.find(HOW_MARKER)
    included_start = html.find(INCLUDED_MARKER)

    if min(card_start, how_start, included_start) < 0:
        raise RuntimeError("Required course page marker not found")

    if how_start < card_start < included_start:
        return

    card_end = html.find(SECTION_END, card_start)
    if card_end < 0:
        raise RuntimeError("Free class card closing section not found")
    card_end += len(SECTION_END)

    card = html[card_start:card_end]
    html = html[:card_start] + html[card_end:]

    included_start = html.find(INCLUDED_MARKER)
    if included_start < 0:
        raise RuntimeError("Included section marker not found after card removal")

    html = html[:included_start] + card + html[included_start:]
    COURSE_PATH.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    move_card()
