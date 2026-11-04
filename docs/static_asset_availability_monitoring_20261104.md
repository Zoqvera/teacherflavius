# Monitoramento preventivo de arquivos estáticos

Data: 04/11/2026.

## Evidências da investigação

Em 04/11/2026 às 01h09 (America/Sao_Paulo), não havia eventos novos
de falha interna desde a publicação do monitor de recursos, ocorrida
poucos minutos antes. O check de saúde estava `healthy`, com zero
falhas internas e 4/4 endpoints de disponibilidade em HTTP 200.

O histórico anterior apresenta grupos de 5–8 arquivos JS/CSS falhando
quase simultaneamente no mesmo carregamento de página. O registro
prévio não incluía o status HTTP desses recursos. Não há evidência
suficiente para atribuir a causa a um arquivo ausente ou a uma falha
sistêmica da hospedagem.

## Verificações adicionadas

O workflow `.github/workflows/production-availability.yml`, já
agendado para os minutos 07 e 37 de cada hora, agora verifica seis
recursos críticos com GET:

- `/error_monitor.js`
- `/student_access_tracker.js`
- `/student_policy_notice_loader.js`
- `/site_page_context.js`
- `/animated_cards.css`
- `/course_tools.css`

A verificação exige status HTTP 200, MIME esperado para JS/CSS e
resposta não vazia. Rejeita respostas HTML em lugar de scripts ou estilos.
Ao falhar, repete no máximo três vezes por recurso, com intervalo de
dois segundos. Exibe caminho e tipo de falha no log do GitHub Actions,
sem registrar dados dos alunos ou carregar páginas autenticadas.

Em pull requests, valida os contratos em testes unitários isolados e
confirma que os seis arquivos existem na saída `_site`. Não consulta
a produção a partir de uma PR.

## Limites e critérios de ação

O probe ocorre a partir de um runner do GitHub, e não substitui a
telemetria de navegadores reais. Uma falha de rede exclusiva do usuário
pode não ser reproduzida pelo runner. Um GET bem-sucedido não confirma
que todos os usuários receberam os arquivos. O status HTTP dos eventos
de navegador, quando disponível, continua sendo o melhor indicador
para diferenciar 404, 5xx e falhas sem resposta HTTP.

Se houver novos incidentes, correlacionar horário, arquivo, status,
Content-Type e resultados do workflow. Não implementar mudanças em CDN,
headers ou cache sem evidência objetiva.

## SEO

Não foram alterados URLs de páginas, URLs canônicos, meta tags,
robots.txt, sitemap ou conteúdo público. A alteração afeta somente
instrumentação de monitoramento e o pipeline de disponibilidade.
