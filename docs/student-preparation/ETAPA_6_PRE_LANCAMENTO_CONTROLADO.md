# ETAPA 6 — Pré-lançamento controlado do fluxo de preparação

**Data:** 15/10/2026  
**Estado:** candidato de pré-lançamento; sem ativação para alunos do domínio principal.

## Escopo e isolamento

- Domínio principal `teacherflavius.com` (inclusive `www`): experiência antiga permanece ativa.
- Somente o hostname exato `stage6-student-preparation-preview-teacherflavius.handinhandengl.workers.dev` habilita o novo fluxo. Qualquer outro hostname permanece com `enabled=false`.
- Páginas carregadas pelo novo fluxo no hostname de pré-lançamento recebem `noindex,nofollow`. No domínio principal não há mudança de metadados de SEO ou canonical.
- É um **ambiente de interface**, não um banco de dados separado. Qualquer sessão autenticada no preview ainda pode atingir os serviços reais. Portanto, **não usar contas de alunos nem alterar dados reais** durante testes de interface; usar exclusivamente os testes automatizados com dados sintéticos.
- Não encaminhar o endereço de pré-lançamento a estudantes. Não considerar um domínio de preview público como um controle de acesso.

## Critérios de liberação

1. Confirmar **18/18** checks da PR e sucesso dos cenários de interface (desktop e móvel) e controladores.
2. Confirmar a origem do acesso:
   - O QUE FAZER > COMEÇAR > lição prevista: **somente PRÓXIMA PARTE**.
   - Roteiro de estudos > lição: **somente PRÓXIMA LIÇÃO**, quando publicada.
   - Nunca permitir os dois botões simultaneamente.
   - Com o recurso desativado: continuar mostrando **ESTOU PREPARADO** no fluxo anterior.
3. Confirmar autenticação, ausência de dados privados expostos, tratamento de lição não publicada, links internos e ausência de overflow horizontal.
4. Executar teste de não regressão nos fluxos de reposição, calendário de aulas e roteiro.
5. Somente depois escolher se haverá implantação por grupo-piloto e quais alunos participarão. **Ainda não existe seleção de usuários por coorte neste release**; não mudar o padrão global para `true` como substituto para esse controle.
6. Validar as implicações de SEO antes de qualquer alteração de links públicos, canonical, robots ou sitemap.
7. Solicitar a decisão expressa do responsável antes de qualquer liberação efetiva no domínio principal.

## Reversão e observabilidade

- Este candidato **não** possui migração de banco, mutação de dados ou habilitação global.
- Em caso de incidente no preview, desabilitar a configuração exclusiva de hostname ou interromper sua distribuição. O domínio principal já está no estado original.
- Para uma futura liberação produtiva, prever botão de reversão operacional independente de deploy, métricas de erro/latência, testes com uma conta autorizada e janela de observação acordada.
- Não tratar checks de CI isoladamente como comprovação de que o login completo funciona com usuários reais em produção.

## Próxima etapa

**ETAPA 7 — Piloto restrito, monitoramento e decisão de expansão**: escolher coorte, construir controle de elegibilidade associado à identidade do estudante, testar em ambiente isolado com dados não produtivos e só então habilitar o acesso aos usuários autorizados.
