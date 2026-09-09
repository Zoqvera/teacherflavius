from pathlib import Path

HOME_PATH = Path("index.html")
STYLESHEET = '  <link rel="stylesheet" href="/home_vacancies.css?v=20260909-1">'
CONFIG_SCRIPT = '  <script src="/supabase_config.js?v=20260902-1"></script>'
VACANCIES_SCRIPT = '  <script defer src="/home_vacancies.js?v=20260909-1"></script>'
FAQ_MARKER = '    <section class="faq" aria-labelledby="faq-title">'
PRIVACY_MARKER = '    <script src="/site_privacy_analytics.js?v=20260902-1"></script>'

VACANCIES_SECTION = '''    <section class="home-vacancies-section" aria-labelledby="home-vacancies-title">
      <div class="shell home-vacancies-card">
        <div class="home-vacancies-head">
          <p class="eyebrow">Vagas disponíveis agora</p>
          <h2 id="home-vacancies-title">Veja quais turmas em grupo já estão em andamento e ainda têm vaga.</h2>
          <p id="homeVacanciesSummary">Consultando a disponibilidade atual das turmas...</p>
        </div>
        <div id="homeVacanciesList" class="home-vacancies-grid" aria-live="polite">
          <div class="home-vacancies-empty">Carregando vagas disponíveis...</div>
        </div>
        <div class="home-vacancies-cta">
          <a class="btn btn-primary" href="https://wa.me/5534998349756?text=Ol%C3%A1%2C%20gostaria%20de%20marcar%20uma%20aula%20experimental." target="_blank" rel="noopener noreferrer">AGENDAR UMA AULA EXPERIMENTAL GRATUITA</a>
        </div>
      </div>
    </section>

'''


def insert_after(html: str, marker: str, addition: str) -> str:
    if addition in html:
        return html
    if marker not in html:
        raise RuntimeError(f"Marker not found: {marker}")
    return html.replace(marker, marker + "\n" + addition, 1)


def apply() -> None:
    html = HOME_PATH.read_text(encoding="utf-8")

    brand_marker = '  <link id="teacher-flavius-brand-palette" rel="stylesheet" href="/brand_palette.css?v=20260820-3">'
    if STYLESHEET not in html:
        html = insert_after(html, brand_marker, STYLESHEET)

    if 'id="homeVacanciesList"' not in html:
        if FAQ_MARKER not in html:
            raise RuntimeError("FAQ marker not found")
        html = html.replace(FAQ_MARKER, VACANCIES_SECTION + FAQ_MARKER, 1)

    if CONFIG_SCRIPT not in html or VACANCIES_SCRIPT not in html:
        if PRIVACY_MARKER not in html:
            raise RuntimeError("Privacy script marker not found")
        scripts = []
        if CONFIG_SCRIPT not in html:
            scripts.append(CONFIG_SCRIPT)
        if VACANCIES_SCRIPT not in html:
            scripts.append(VACANCIES_SCRIPT)
        html = html.replace(PRIVACY_MARKER, "\n".join(scripts) + "\n" + PRIVACY_MARKER, 1)

    HOME_PATH.write_text(html, encoding="utf-8")


if __name__ == "__main__":
    apply()
