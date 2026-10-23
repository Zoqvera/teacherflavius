# Roteiro da Aula v2 — homologação e ativação

## Estado atual

A página operacional continua em `/roteiro-da-aula/`. A prévia fica em
`/roteiro-da-aula-v2/` e usa `noindex, nofollow`. As chaves
`PRESENTATION_REGISTRATION_ENABLED`, `QUESTION_RATINGS_ENABLED` e
`SESSION_LIFECYCLE_ENABLED` devem permanecer `false` até que todos os
itens abaixo estejam aprovados.

O banco de produção ainda não recebeu as migrações da etapa 3
(`20261022202000`), da etapa 4 (`20261022212500`, `20261022214500`)
e o ajuste de concorrência (`20261022220000`).

**Importante:** não executar a ferramenta genérica `apply_migration`,
`supabase db push`, `migration repair` ou `db reset` na produção.
O histórico produtivo e os arquivos do repositório são divergentes.
O procedimento aprovado em funcionalidades anteriores exigiu um workflow
transacional **seletivo**, com verificação do histórico atual, backup
restaurável, ensaio sintético e lançamento das versões canônicas juntamente
com o DDL; nenhuma migração fora da lista aprovada é aplicada.
A nova etapa necessita procedimento equivalente, revisado e autorizado
segundo `docs/supabase-migration-ledger-cutover-runbook.md` e
`docs/apresentacoes-licoes-etapa5b.md`. Nunca editar o ledger para
mascarar divergências.

## Bloqueio identificado na auditoria de 22/10/2026

Durante a homologação, o histórico produtivo avançou para
`20261022205054 — add_tuition_email_reminders`. O repositório contém
`20261022230000_add_tuition_email_reminders.sql`, ainda sem equivalência
de checksum atestada para esse par de versões.

A verificação `compare-production-history` da PR #876 interrompeu a
integração pelos seguintes motivos:
- `20261022205054` existe somente no ledger de produção;
- `20261022202000_teacher_question_ratings_v2.sql` é uma migração local
  pendente anterior à nova ponta de produção.

Os testes de interface não substituem esse gate. Não alterar a
migração já commitada `20261022202000`, não suprimir o erro e não
forçar merge. Antes de implementar o cutover, é necessária uma
reconciliação **auditável e versionada**, apoiada por backup e testes
em ambiente descartável, para garantir que a migração pendente possa ser
aplicada sem reordenar incorretamente a cadeia SQL.

## 5A — Integração de segurança (preparada)

- Reutilizar a mesma trava transacional entre encerramento e registros
  de apresentação, avaliação e participação excepcional.
- Rejeitar novas atividades após 90 minutos, direcionando correções
  posteriores à rotina administrativa auditável.
- A versão antiga mantém suas RPCs intactas.
- Testes estáticos e mocks de concorrência são necessários, mas não
  suficientes para liberar aulas reais.

## 5B — Aplicação e teste de migrações (pendente)

1. Criar backup testável do banco e registrar as versões já aplicadas.
2. Aplicar as quatro migrações **na ordem** em um ambiente de teste
   compatível, com `cron` neutralizado e dados sintéticos.
3. Testar com uma sessão em que aluno A apresentou, B teve pergunta
   avaliada, C participou excepcionalmente, D não interagiu e E cancelou.
4. Confirmar: A/B/C presentes, D ausente e E cancelado, sem crédito
   indevido, sem duplicidade e fechamento da turma após 90 minutos.
5. Testar reposição agendada, aluno arquivado, mudança de turma,
   apresentação já registrada, avaliações repetidas, fuso horário e
   duas abas concorrentes.
6. Confirmar que falhas no worker não levam a perda de dados, e que
   a execução repetida é idempotente.
7. Executar um **workflow transacional seletivo** aprovado e
   explicitamente confirmado, que aplique apenas as quatro versões
   canônicas e registre cada versão no ledger na mesma transação do DDL;
   preservar `enabled=false`. Não executar em lote as migrações históricas.
   Consultar novamente permissões/RLS após commit.
8. Conferir o histórico de classes finalizadas manualmente e as
   correções administrativas com justificativa.

## 5C — Troca controlada (não autorizada pelos testes atuais)

Após todos os testes:
1. Publicar a nova página com as três chaves de escrita habilitadas,
   preservar o roteiro antigo sob uma rota de retorno e validar
   autenticação do professor.
2. Fixar `private.academic_v2_automation_control.enabled_from` para
   as próximas aulas, nunca retroagindo aos encontros que já ocorreram.
3. Ativar o worker de encerramento, verificar no banco o status
   `enabled=true`, histórico dos jobs e uma sessão de teste real
   consensual e supervisionada.
4. Trocar a entrada da área do professor apenas após confirmar
   o resultado e a capacidade de retorno.
5. Se qualquer verificação falhar, manter as chaves desativadas, não
   alterar o menu e não afetar a página atual.

## Etapa 5D — auditoria do histórico em 23/10/2026

A produção avançou de 350 para 352 versões enquanto a nova interface
continuava desligada:

- `20261023015816_respect_capacity_override_for_class_52.sql`
- `20261023020702_honor_quintet_capacity_overrides.sql`

Os conteúdos foram recuperados diretamente da tabela oficial
`supabase_migrations.schema_migrations.statements` em modo leitura,
com identidade, texto SQL e SHA-256, e registrados no Git como arquivos
**já aplicados**, sem reexecução. O verificador de divergências passa a
reconhecer somente as cinco migrações v2 **pendentes** com identidades
imutáveis e checagem no catálogo que garante a ausência dos novos objetos.

Consequentemente, a instalação seletiva do roteiro exige agora 352
versões no início, exatamente a ponta `20261023020702`, e deverá
resultar em 357 versões sem alterar a ponta cronológica. Qualquer nova
migração produtiva exigirá nova conciliação antes do deploy.

A restauração do backup e o ensaio manual na mesma revisão da `main`
continuam obrigatórios. A disponibilidade de um script de instalação
não equivale à aprovação para alterar o banco. A interface operacional
`/roteiro-da-aula/` e todos os controles da v2 permanecem inalterados.

## Etapa 5C — implantação seletiva preparada (ainda não executada)

O workflow `.github/workflows/teacher-v2-stage5c-schema.yml` é
**somente manual**, na branch `main`. Exige a frase específica
`CONFIRMO_ROTEIRO_V2_5C`, um backup criptografado recente com restauração
atestada e uma execução manual do workflow
`Validate Supabase baseline restore` bem-sucedida na **mesma revisão
Git**, há menos de 24 horas.

O SQL `scripts/sql/teacher_v2_stage5c_selective_rollout.sql` verifica
exatamente o histórico produtivo esperado (352 versões e ponta
`20261023020702`), exige ausência dos objetos da versão nova, aplica
**somente cinco migrações imutáveis** e grava as respectivas versões e os conteúdos SQL completos na tabela
`supabase_migrations.schema_migrations` em uma única transação PostgreSQL.
Isso preserva a verificação normal do histórico de migrações, sem
exceções de checksum nem modificações nas migrações antigas. Qualquer conflito ou falha
de DDL cancela toda a transação.

O pós-teste exige 357 versões, tabelas privadas com RLS, permissão
administrativa sem acesso anônimo, tabelas de auditoria vazias e o
controle `enabled=false`, `enabled_from=null`. O worker pode estar
agendado mas executa `return 0`; nenhuma aula é encerrada por ele.
Os três flags de gravação da página v2 também permanecem desativados.

**Nenhum workflow manual de implantação foi iniciado nesta etapa.**
Não há autorização implícita para trocar a URL ativa, habilitar os
botões ou finalizar aulas reais. A verificação de ponta a ponta em
navegador e a reversão operacional são condições da etapa seguinte.

### Pendência de homologação

O primeiro ensaio estendido da turma fictícia encontrou diferença no
esquema do banco descartável (coluna de primeira aula). O segundo
detectou a taxonomia `quintet` para turmas no esquema canônico.
Esses ajustes foram realizados exclusivamente nos testes. É obrigatório
obter uma execução **completa e aprovada** do ensaio de presença,
ausência, cancelamento, idempotência, auditoria e recuperação antes
de qualquer implantação produtiva.

## SEO

Ambas as rotas administrativas usam `noindex, nofollow`. Uma eventual
troca de URL deve manter esse controle e não poderá incluir páginas
administrativas no sitemap público. Informar ao responsável antes da troca.
