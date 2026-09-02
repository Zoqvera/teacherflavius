from pathlib import Path

path = Path("curso-de-ingles-online/index.html")
html = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str, label: str) -> None:
    global html
    if new in html:
        return
    if old not in html:
        raise SystemExit(f"Anchor not found: {label}")
    html = html.replace(old, new, 1)


old_card = '<article class="card"><h3>Certificado por módulo</h3><p>Ao final de cada módulo, o aluno pode receber um certificado de conclusão após realizar uma avaliação final correspondente ao nível de proficiência alcançado.</p></article>'
new_card = '<article class="card"><h3>Certificado por módulo</h3><p>Ao final de cada módulo, o certificado é emitido mediante pelo menos 70% de acertos na avaliação final e o cumprimento da frequência exigida para a etapa.</p></article>'
replace_once(old_card, new_card, "certificate card")

levels_total = '''        <div class="levels-total" aria-label="Tempo total do curso: 24 meses">
          <p class="levels-total-copy"><strong>Tempo total do início ao fim</strong><span>Iniciante + Intermediário + Avançado</span></p>
          <p class="levels-total-time">24 <small>meses</small></p>
        </div>'''
certificate_panel = levels_total + '''
        <div class="certificate-panel" aria-labelledby="certificate-criteria-title">
          <p class="eyebrow">Certificação por módulo</p>
          <h3 id="certificate-criteria-title">Critérios claros para receber o certificado de conclusão.</h3>
          <p class="certificate-lead">Ao final de cada módulo, o aluno realiza uma avaliação correspondente ao nível estudado. Para receber o certificado, é necessário cumprir dois critérios: obter pelo menos 70% de acertos na avaliação final e completar a frequência exigida para a etapa.</p>
          <div class="certificate-rule-grid">
            <div class="certificate-score" aria-label="Nota mínima de 70 por cento de acertos">
              <strong>70%</strong>
              <span>nota mínima de acertos na avaliação final</span>
            </div>
            <div class="certificate-attendance" aria-label="Frequência exigida por módulo">
              <p><strong>Iniciante · A1/A2</strong><span>24 aulas</span></p>
              <p><strong>Intermediário · B1/B2</strong><span>24 aulas</span></p>
              <p><strong>Avançado · C1/C2</strong><span>48 aulas</span></p>
            </div>
          </div>
          <p class="certificate-note">Se precisar reorganizar uma aula, as reposições podem ser marcadas diretamente pelo site. Os critérios de certificação ficam disponíveis desde o início para que o aluno acompanhe seu percurso com clareza.</p>
        </div>'''
replace_once(levels_total, certificate_panel, "certificate criteria panel")

old_row = '<tr><td>Certificado ao final de cada módulo</td><td class="yes">Após avaliação final</td></tr>'
new_row = '<tr><td>Certificado ao final de cada módulo</td><td class="yes">70% na avaliação + frequência exigida</td></tr>'
replace_once(old_row, new_row, "certificate comparison row")

old_faq = '<article class="faq-item"><h3>O curso oferece certificado?</h3><p>Sim. Ao final de cada módulo, o aluno pode receber um certificado de conclusão. A emissão ocorre após a realização de uma avaliação final com conteúdos e competências correspondentes ao nível de proficiência alcançado.</p></article>'
new_faq = '<article class="faq-item"><h3>O curso oferece certificado?</h3><p>Sim. Há certificado de conclusão ao final de cada módulo. Para recebê-lo, o aluno precisa obter pelo menos 70% de acertos na avaliação final correspondente ao nível estudado e cumprir a frequência exigida: 24 aulas no módulo Iniciante (A1/A2), 24 aulas no Intermediário (B1/B2) e 48 aulas no Avançado (C1/C2).</p></article>'
replace_once(old_faq, new_faq, "certificate FAQ")

path.write_text(html, encoding="utf-8")
