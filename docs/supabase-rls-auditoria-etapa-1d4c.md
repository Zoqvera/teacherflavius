# ETAPA 1D.4C — auditoria de lacunas do Supabase após a PR #794

Data da captura: **17/10/2026**. Referência: commit da `main`
`1bd51c12387d9640ae6805d238d2243b023ca927`, execução protegida
[Supabase canonical object inventory #39030867812](https://github.com/Zoqvera/teacherflavius/actions/runs/39030867812),
artefato `supabase-schema-object-gap-assessment` (ID `12099914402`).
A cópia verificável de **metadados agregados**, sem expressões SQL, está em
[`supabase-rls-stage1d4c-snapshot.json`](supabase-rls-stage1d4c-snapshot.json).

## Resultado verificado

| Indicador | Resultado |
| --- | ---: |
| Objetos catalogados na reconstrução | 1.778 |
| Objetos catalogados na produção | 2.911 |
| Identificadores comuns | 1.777 |
| Definições idênticas entre identificadores comuns | 1.602 |
| Definições divergentes entre identificadores comuns | 175 |
| Objetos ausentes no bootstrap | 1.134 |
| Objetos extras no bootstrap | 1 |
| Políticas RLS no bootstrap e produção | 95 / 109 |
| Políticas ausentes em relações já reconstruídas | **0** |
| Políticas ausentes em relações ainda não reconstruídas | **14** |
| Políticas com papéis ou comandos divergentes | **0** |
| Políticas presentes com predicados divergentes | **4** |
| Possíveis ampliações de papel detectadas pelo comparador | **0** |

A ausência de alertas de ampliação por papel **não demonstra equivalência
de autorização**. A comparação analisa objetos por identificador,
definições por hash e predicados separadamente. Não substitui testes de
RLS com identidades e privilégios fictícios, restauração remota nem
verificação de backup.

O único objeto adicional identificado na reconstrução é o gatilho
`public.profiles.activate_completed_google_student_profile_before_write`.
Não removê-lo automaticamente: verificar sua finalidade, funções
dependentes e comportamento antes de qualquer decisão.

## Dependências: pacotes candidatos a recuperação

Todas as **14 políticas** dependem de **11 relações ausentes**.
Nenhuma deve ser adicionada antes da tabela, constraints, grants e
dependências correspondentes.

| Prioridade | Pacote | Tabelas | Políticas |
| --- | --- | ---: | ---: |
| 1 | Proteção de dados e retenção | 3 | 4 |
| 2 | Estado acadêmico e preparação | 3 | 3 |
| 3 | Conteúdo gerenciável do site | 1 | 3 |
| 4 | Aquisição e atribuição comercial | 4 | 4 |
| **Total** | | **11** | **14** |

**1. Proteção de dados e retenção:** `public.data_retention_policies`,
`public.data_retention_runs`, `public.data_subject_requests`.
Prioridade por controles de privacidade e obrigações de atendimento a
solicitações dos titulares. Verificar os fluxos e funções de LGPD antes
de reconstruir permissões.

**2. Estado acadêmico e preparação:** `public.student_course_states`,
`public.student_preparation_pilot_members`,
`public.student_preparation_pilot_settings`.
Prioridade funcional para reconciliação de estados acadêmicos e
integrações das lições. Testar acesso de aluno e professor com
identidades fictícias, sem liberar a PR #776.

**3. Conteúdo gerenciável do site:** `public.page_content_overrides`.
Tem três políticas, inclusive leitura pública e escrita administrativa.
A recuperação **somente na instância descartável** não altera SEO;
qualquer futura implantação ou mudança na seleção/renderização de
conteúdo público deve ser analisada separadamente quanto a páginas
indexáveis, metadados e conteúdo visível, com decisão do proprietário.

**4. Aquisição e atribuição comercial:**
`public.marketing_acquisition_events`,
`public.marketing_commercial_leads`,
`public.natanael_acquisition_events`,
`public.natanael_admins`. Exigir negação de acesso direto a dados
comerciais onde originalmente previsto; revisar permissões de funções
e o escopo de administração do módulo antes da restauração.

## Divergência das quatro políticas de páginas de lição

As quatro políticas de `public.study_lesson_pages` possuem
predicados diferentes entre bootstrap e produção. Não há diferença
de papéis ou comandos nesses itens. Na captura de 17/10/2026,
`public.is_teacher_admin_mfa()` estava definido tanto na produção
quanto no overlay `42_require_live_admin_auth_session.sql` como
**alias administrativo**, delegando a `public.is_teacher_admin()`
para sessões autenticadas comuns. Seu próprio comentário informa que
**não exige AAL2/MFA**. Assim, o nome da função não constitui evidência
de proteção mais rigorosa. Eventual mudança para exigir AAL2
seria uma alteração de regra de acesso e precisa de avaliação funcional
separada, não uma normalização automática de hashes.

## Critérios de execução dos próximos pacotes

1. Reconstruir um módulo por PR, a partir de SQL histórico revisado
   e dados estritamente fictícios em banco descartável.
2. Verificar identidade e dependências das tabelas, chaves,
   constraints, índices, triggers e grants antes de adicionar políticas.
3. Validar com PostgreSQL real e papéis `anon`, `authenticated`,
   aluno proprietário, aluno não proprietário e professor, conforme
   a semântica do módulo.
4. Comparar novamente inventário e RLS via workflow protegido na
   `main` após o merge. Exigir redução dos gaps esperados sem
   aumentar diferenças de papéis, comandos ou privilégios.
5. Não reintroduzir o módulo cancelado de Tarefas para Casa, não
   modificar o ledger produtivo e não promover alterações da PR #776.

## Escopo e limites desta etapa

Este relatório e seu teste de contrato apenas registram e classificam
evidência já produzida. Não há implantação de schema, alteração de
permissões produtivas, sincronização de dados, branch remota paga ou
mudança de interface, rotas e SEO. O histórico divergente de migrações
continua bloqueando o cutover e a publicação das apresentações.
