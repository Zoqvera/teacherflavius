# ETAPA 7 — Piloto restrito, monitoramento e reversão

**Estado em 15/10/2026:** implementação preparada; **nenhum aluno habilitado** e chave de produção **desligada**.

## Regra de elegibilidade

O novo fluxo exige **todas** as condições a seguir em `teacherflavius.com` e `www.teacherflavius.com`:

1. `PRODUCTION_PILOT_ARMED` deve ser explicitamente habilitado em `student_preparation_flow.js` após decisão do responsável; no código integrado nesta etapa vale `false`.
2. A pessoa precisa ter uma sessão Supabase autenticada; a página aguarda `Auth.getSession()` antes de consultar a elegibilidade.
3. O operador precisa habilitar `public.student_preparation_pilot_settings.enabled` no banco; a migração inicial instala `false`.
4. A pessoa precisa ter uma linha própria `enabled=true` em `public.student_preparation_pilot_members`, associada ao `auth.users.id` do titular.

Qualquer falha de leitura, identidade ausente, resultado inesperado ou hospedagem fora da lista autorizada retorna `false`. A interface legada permanece acessível. A mera presença de um parâmetro de URL não altera a elegibilidade.

**O preview da Etapa 6 continua habilitado pelo hostname exclusivo para testes de interface**, com `noindex,nofollow`; este hostname não é um mecanismo de autenticação nem possui banco de dados independente. Não usar contas reais nele para executar mutações.

## Migração e autorização

Arquivo: `supabase/migrations/20261015213000_student_preparation_pilot_eligibility.sql`.

- Chave geral singleton desabilitada por padrão e tabela de participantes vazia.
- RLS habilitado nas duas tabelas; `authenticated` recebe somente `SELECT`.
- Cada aluno só pode ler o próprio registro, com `auth.uid()`.
- Estudantes e visitantes não podem cadastrar, excluir ou habilitar participantes; gerenciamento reservado ao operador pelo contexto `service_role`.
- O site não acessa chaves privilegiadas nem aceita o identificador do aluno de parâmetros de URL.
- O merge desta PR **não deve ser interpretado como aplicação da migração**. Validar no ambiente isolado e executar os controles de segurança antes de aplicar ao banco de produção.

## Acompanhamento

Emite somente nomes de eventos enumerados no módulo, via instrumentação GA4 existente e **somente quando `TeacherFlaviusPrivacy.hasAnalyticsConsent()` retornar `true`**:

| Evento | Significado |
|---|---|
| `preparation_welcome_view` | Entrada na introdução |
| `preparation_lesson_view` | Entrada ou ação de abertura da lição prevista |
| `preparation_next_part` | Clique em PRÓXIMA PARTE |
| `preparation_conversation_view` | Acesso à segunda parte |
| `preparation_roadmap_view` | Acesso ao roteiro/visualização contextual |
| `preparation_next_lesson` | Clique em PRÓXIMA LIÇÃO |

Os eventos não incluem ID, e-mail, nome, lição, telefone ou conteúdo pedagógico. Sem consentimento não há evento. Métricas de sucesso a avaliar com o piloto: progressão INTRODUÇÃO > LIÇÃO > SEGUNDA PARTE, erros de navegação, legibilidade em dispositivos móveis e solicitações de suporte. A ausência de evento não indica abandono quando o consentimento foi negado.

## Plano de homologação e ativação

1. Homologar o schema e as políticas RLS em um ambiente Supabase **isolado**, com usuários sintéticos distintos, confirmando que nenhum aluno pode consultar a linha de outro ou se inserir.
2. Executar testes unitários (chave desligada, chave de banco desligada, pessoa não elegível, rede indisponível, consentimento negado) e aceitação real em Chromium.
3. Verificar operações pedagógicas legadas (preparação, roteiro, reposições e cronograma).
4. Obter decisão explícita sobre os participantes do piloto e validar seus identificadores `auth.users.id`.
5. Aplicar a migração em produção somente após homologação; consultar advisors de segurança. Sem participantes cadastrados, nenhuma pessoa adquire acesso por engano.
6. Cadastrar apenas participantes autorizados com privilégios administrativos, habilitando suas linhas; preservar `settings.enabled=false` durante a preparação.
7. Em PR distinta e mediante autorização, armar o código para produção e, por último, habilitar a chave no banco.
8. Monitorar taxas agregadas e eventuais falhas; não ampliar a coorte sem nova autorização.

## Reversão imediata e isolamento

- Quando o piloto estiver ativado, o operador desliga **`student_preparation_pilot_settings.enabled`** no banco, sem editar código ou fazer deploy. A próxima navegação autenticada aplicará o estado desligado.
- Revogar individualmente ajustando `student_preparation_pilot_members.enabled=false`.
- Não excluir dados pedagógicos, alterar financeiro ou voltar mudanças de conteúdo para reverter a experiência.
- Se a plataforma de dados ficar indisponível, o comportamento é **fail-closed**.

## SEO

As alterações desta etapa não mudam canonical, sitemap, robots.txt nem indexação do site principal. O `noindex,nofollow` da Etapa 6 permanece restrito ao hostname de testes. Qualquer mudança posterior de SEO exige decisão separada do responsável.

## Etapa seguinte

**ETAPA 8 — Homologação com Identidades Sintéticas e Decisão de Ativação do Piloto.** A versão de produção permanece desativada até aprovação e seleção de participantes.
