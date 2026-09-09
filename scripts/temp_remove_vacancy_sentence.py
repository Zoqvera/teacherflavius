from pathlib import Path

TARGET = "Veja quais turmas em grupo já estão em andamento e ainda têm vaga."


def update_semantic_headings(html: str) -> str:
    replacements = {
        '<p class="eyebrow">Vagas disponíveis agora</p>\n          <h2 id="vacancies-title">' + TARGET + '</h2>':
            '<h2 id="vacancies-title" class="eyebrow">Vagas disponíveis agora</h2>',
        '<p class="eyebrow">Vagas disponíveis agora</p>\n          <h2 id="home-vacancies-title">' + TARGET + '</h2>':
            '<h2 id="home-vacancies-title" class="eyebrow">Vagas disponíveis agora</h2>',
    }
    for old, new in replacements.items():
        html = html.replace(old, new)
    return html


def remove_target_sentence() -> list[Path]:
    changed: list[Path] = []
    for path in Path('.').rglob('*.html'):
        if '.git' in path.parts or '_site' in path.parts:
            continue
        html = path.read_text(encoding='utf-8')
        if TARGET not in html:
            continue
        updated = update_semantic_headings(html).replace(TARGET, '')
        path.write_text(updated, encoding='utf-8')
        changed.append(path)
    return changed


if __name__ == '__main__':
    files = remove_target_sentence()
    print('Updated:', ', '.join(str(path) for path in files) or 'none')
