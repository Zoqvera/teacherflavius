from pathlib import Path

COURSE_PATH = Path("curso-de-ingles-online/index.html")
STYLESHEET = '<link rel="stylesheet" href="/course_free_class.css?v=20260909-1">'
SCRIPT = '<script defer src="/course_free_class.js?v=20260909-1"></script>'
SECTION_MARKER = '    <section id="como-funciona" class="section" aria-labelledby="how-title">'

FREE_CLASS_SECTION = '''    <section class="course-free-class-section" aria-labelledby="course-free-class-title">
      <div class="shell">
        <div class="course-free-class-card">
          <div class="course-free-class-copy">
            <h2 id="course-free-class-title">Assista a uma aula gratuita</h2>
            <p>Veja como uma aula de inglês pela internet funciona antes de decidir.</p>
          </div>
          <div class="course-free-class-frame" id="courseFreeClassFrame">
            <button class="course-free-class-trigger" id="courseFreeClassTrigger" type="button" aria-label="Reproduzir aula gratuita do Teacher Flávio">
              <span class="course-free-class-play" aria-hidden="true">▶</span>
            </button>
          </div>
        </div>
      </div>
    </section>

'''


def insert_after(html: str, marker: str, addition: str) -> str:
    if addition in html:
        return html
    if marker not in html:
        raise RuntimeError(f"Marker not found: {marker}")
    return html.replace(marker, marker + "\n  " + addition, 1)


def apply() -> None:
    html = COURSE_PATH.read_text(encoding="utf-8")

    stylesheet_marker = '  <link rel="stylesheet" href="/course_funnel.css?v=20260902-1">'
    if STYLESHEET not in html:
        if stylesheet_marker not in html:
            raise RuntimeError("Course funnel stylesheet marker not found")
        html = html.replace(stylesheet_marker, stylesheet_marker + "\n  " + STYLESHEET, 1)

    if 'id="courseFreeClassFrame"' not in html:
        if SECTION_MARKER not in html:
            raise RuntimeError("Course section marker not found")
        html = html.replace(SECTION_MARKER, FREE_CLASS_SECTION + SECTION_MARKER, 1)

    if SCRIPT not in html:
        if "</body>" not in html:
            raise RuntimeError("Closing body marker not found")
        html = html.replace("</body>", "  " + SCRIPT + "\n</body>", 1)

    COURSE_PATH.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    apply()
