# Proteção rápida de merges na main

O check **Fast critical changes gate** roda em todas as PRs para main, sem
filtro de arquivos e com timeout de dois minutos. Executa só testes locais,
sem credenciais, rede externa, Docker, branches Supabase ou deploy.

Verifica a imutabilidade das migrações históricas e executa contratos de
autenticação, pagamento e banco apenas se esses caminhos foram alterados.
Uma PR documental apenas valida a política e encerra normalmente.

A reconstrução via Supabase CLI, Lighthouse, compilação Android, probes de
pagamentos reais e previews remotas continuam separadas e NÃO bloqueantes.
O check rápido não substitui uma validação remota, não libera alteração em
produção e não reativa o isolated-preview-gate.

## Required status checks recomendados

Na ruleset 24970258 (Proteção da main — testes obrigatórios), selecionar
somente os nomes de JOBS abaixo (GitHub Actions), presentes em toda PR:

- javascript-quality
- security-baseline
- dependency-baseline
- reject-obsolete-sql
- Validate technical SEO
- Validate clean URLs
- Validate accessibility baseline
- Validate responsive compatibility
- Static performance budgets
- Fast critical changes gate

Não cadastrar como globais os checks de workflows filtrados por arquivos,
nem Lighthouse lab guardrails, Android Capacitor build, Supabase CLI-native
branching rehearsal ou isolated-preview-gate.

A conexão GitHub deste projeto não oferece ação para editar rulesets.
Após o merge, concluir manualmente em:
Settings > Rules > Rulesets > Proteção da main — testes obrigatórios >
Required status checks. Manter os outros controles já existentes.

SEO: alteração somente de políticas CI, sem mudanças em páginas, URLs,
metadados, sitemap, canonical, robots ou indexação.
