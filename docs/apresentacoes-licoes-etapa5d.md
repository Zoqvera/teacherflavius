# Apresentações de lições — Etapa 5D: homologação de publicação e Android

Data: 17/10/2026. Nenhum dado de aluno foi alterado.

## Situação auditada

- PR #810 já integrada à `main` (`6c995abaad5646cfbf192e337b33355a25349819`).
- GitHub Pages, execução `39051048300`: `build`, `report-build-status`
  e `deploy` aprovados.
- Android Capacitor, execução `39051048919`: compilação, assinatura e
  verificação do AAB aprovadas. Artefatos disponíveis:
  `teacher-flavio-android-debug` e
  `teacher-flavio-android-release-signed`, até 24/10/2026.
- AAB gerado com `mobile/android_release.json`: `versionCode: 2`,
  `versionName: 1.0.1`. **A compilação não comprova a publicação
  de uma atualização pela loja**. Antes de enviar novo AAB, conferir o
  último `versionCode` já aceito pelo Google Play.
- Supabase com 318 migrações e três tabelas de apresentações protegidas
  por RLS. Na inspeção agregada, existiam **2 apresentações, 2 revisões
  e 0 recibos docentes**. Nenhum texto, nome, e-mail nem UUID
  individual foi consultado.
- Mudanças de indexação ou de conteúdo público: nenhuma.

## Teste automático de publicação, sem autenticação

`scripts/smoke_lesson_presentations_public.py` consulta apenas
recursos públicos por HTTPS:

1. `/licao/` e `/roteiro-da-aula/`, exigindo `noindex,nofollow`
   e referências às versões aprovadas dos scripts.
2. Os dois módulos JavaScript publicados, exigindo
   `RELEASE_ENABLED = true` e módulos carregáveis.
3. A configuração pública do Supabase, apenas para obter a *chave
   publicável* que já é fornecida ao navegador.
4. Solicitações de **leitura anônima** às três tabelas de apresentações.
   A verificação exige `401/403` ou `200 []`; nenhum conteúdo de
   apresentações pode ser retornado para visitantes sem login.

A chave publicável nunca é gravada nem impressa nos relatórios. Não
são usadas contas, senhas, service-role nem operações de escrita.
O teste é executado no GitHub Actions por meio do workflow
`lesson-presentations-stage5d-smoke.yml`, ao propor ou integrar a
mudança; há também execução manual disponível.

## Validação do pacote Android

O workflow Android passa a conferir, após `npm run mobile:web` e
antes da geração do projeto nativo, a presença das duas páginas
privadas e dos dois scripts habilitados, com as versões de cache
corretas. A compilação do APK/AAB continua sujeita às verificações
de assinatura e versão já existentes.

## Homologação autenticada pendente

Não é possível verificar completamente fluxos privados apenas com
acesso público ou consulta administrativa ao catálogo.

Usar **contas próprias de homologação**, jamais credenciais reais
de estudantes. Validar no navegador e no app instalado:

1. Entrar como aluno de teste e acessar uma lição por `O QUE FAZER`,
   `ROTEIRO DE ESTUDOS` e por link direto.
2. Enviar texto inofensivo de teste com `ENVIAR APRESENTAÇÃO`.
   Conferir a mensagem `Apresentação enviada ao professor.`.
3. Reabrir a lição; confirmar persistência e o botão
   `EDITAR APRESENTAÇÃO`.
4. No login do professor, abrir a aula correspondente em
   `ROTEIRO DA AULA`. Conferir apresentação acima de
   `PERGUNTAS ESTUDADAS` e o indicador `NÃO VISUALIZADA`.
5. Expandir `LER APRESENTAÇÃO`. Conferir recibo
   `VISUALIZADA` e correspondência com a revisão atual.
6. Alterar a apresentação com o aluno; conferir incremento de revisão,
   preservação do histórico e retorno a `NÃO VISUALIZADA` até
   o professor abrir novamente.
7. Repetir no Android com APK de teste autorizado ou versão
   distribuída, verificando navegação, teclado, envio e sessão.

Após a homologação, consultar apenas contagens de revisão e recibos.
Caso surjam falhas de funcionamento, corrigir em PR específica;
não excluir textos ou recibos de produção.

## Observação Supabase Data API

O Supabase anunciou mudança na exposição automática de novas tabelas
por meio da Data API, com aplicação geral prevista a partir de
30/10/2026. Antes dessa data, verificar no painel que as três
tabelas continuam acessíveis aos papéis **autorizados**, respeitando
RLS. O teste anônimo isolado não comprova a consulta autenticada.

Referência: https://supabase.com/changelog?types=breaking-change

## SEO

Nenhuma alteração em títulos, páginas públicas, robots, sitemap,
canonical nem metadados. As duas rotas privadas continuam com
`noindex,nofollow`. O smoke somente verifica essa proteção.
**Sem impacto novo de SEO nesta etapa.**

**Próxima etapa após publicação e smoke: homologação autenticada do
fluxo no navegador e em dispositivo Android.**
