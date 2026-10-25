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

Naquela revisão, a instalação seletiva exigia 352 versões no início,
exatamente a ponta `20261023020702`, e terminaria com 357 versões.
O histórico mudou novamente em 23/10; conferir a Etapa 5E abaixo. Qualquer nova
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
exatamente o histórico produtivo esperado (353 versões e ponta
`20261023150740`), exige ausência dos objetos da versão nova, aplica
**somente cinco migrações imutáveis** e grava as respectivas versões e os conteúdos SQL completos na tabela
`supabase_migrations.schema_migrations` em uma única transação PostgreSQL.
Isso preserva a verificação normal do histórico de migrações, sem
exceções de checksum nem modificações nas migrações antigas. Qualquer conflito ou falha
de DDL cancela toda a transação.

O pós-teste exige 358 versões, tabelas privadas com RLS, permissão
administrativa sem acesso anônimo, tabelas de auditoria vazias e o
controle `enabled=false`, `enabled_from=null`. O worker pode estar
agendado mas executa `return 0`; nenhuma aula é encerrada por ele.
Os três flags de gravação da página v2 também permanecem desativados.

**A execução manual 39978375351 foi iniciada em 23/10/2026 e interrompida pela guarda de homologação, antes de executar migrações.**
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

## Etapa 5E — reconciliação da migração produtiva de 23/10/2026

A migração `20261023150740_allow_friday_trial_meet_access` foi aplicada em
produção pelo trabalho de aulas experimentais (PR #886). Ela existia no
Supabase antes de estar integrada à `main`. Foram comparados o nome,
a versão, os 1.512 bytes de SQL e o SHA-256
`2335796706ca4ff62a9902f0588d167174f5780cf82c0f5fdd5a2225b9f5fdb0` do arquivo da PR #886
com os registros oficiais do Supabase: equivalência exata.
**Não reexecutar nem renomear essa migração.**

O instalador protegido exige agora 353 versões, ponta
`20261023150740` e o SHA-256 exato da nova migração. Após instalar
**somente as cinco** migrações v2, o histórico deverá ter 358 versões,
mantendo `20261023150740` como ponta cronológica.
Nenhum dado de aluno, mensalidade, página atual ou flag de automação
é alterado por esta conciliação.

O ensaio manual `Validate Supabase baseline restore`
#39978261074 terminou com sucesso em `757b4edf3a782de54b1ad165f4719a6795cf356f`.
A implantação #39978375351 foi iniciada antes do resultado do ensaio:
o gate bloqueou qualquer DDL. Uma nova revisão da `main` exige novo
ensaio manual bem-sucedido nessa mesma revisão e backup recuperável.

**Dependência para prosseguir:** integrar a PR #886 com os checks
obrigatórios válidos. As rulesets atuais bloqueiam o merge devido a
quatro checks exigidos que não receberam status. Corrigir as regras
de proteção no GitHub, sem bypass e sem enfraquecer testes reais.
As chaves e o worker da v2 continuam desligados até homologação completa.

## Etapa 6A — homologação funcional após instalação em produção

Em 23/10/2026, o workflow de instalação protegida #39993728084
(**tentativa 2**) foi concluído com `success`, após o ensaio
descartável #39995700731, ambos na revisão
`324fe10d047d67c90afc73309a25095b19ed2ae5`.

A verificação exclusivamente de leitura do Supabase confirmou:
**358 migrações** e cinco novas versões canônicas, controle de encerramento
`enabled=false` e `enabled_from=null`, tabelas privadas com RLS,
sem leituras anônimas das RPCs administrativas, zero instantâneos de
turmas encerradas e zero linhas de auditoria da v2.

O ensaio SQL em `tests/sql/teacher_v2_disposable_rehearsal.sql`,
executado no banco descartável do workflow
`Validate Supabase baseline restore` dentro de `BEGIN/ROLLBACK`,
foi ampliado para cinco perfis fictícios:

- aluno 1: apresentação registrada, frequência preservada como presente;
- aluno 2: nenhuma atividade, recebe ausência com auditoria única;
- aluno 3: aula cancelada, permanece cancelada;
- aluno 4: arquivado, não entra no encerramento;
- aluno 5: vinculado à turma mas com primeira aula futura, não recebe
  ausência na aula anterior ao início.

O mesmo ensaio verifica que `enabled_from` futuro impede fechamento
retroativo, que dois ciclos consecutivos do worker não duplicam
encerramentos e que o retorno ao estado `enabled=false` não
modifica os dados finalizados.

**Limites desta etapa:** os testes de escrita usam somente alunos
sintéticos e transações revertidas no banco descartável. A homologação
de ponta a ponta dos fluxos administrativos (avaliação de perguntas,
apresentações, reposições e correções auditadas com sessão real de
professor), concorrência entre duas abas, acessibilidade móvel e
reversão da navegação ainda precisam ser comprovadas antes de
qualquer ativação.

A página `/roteiro-da-aula/` permanece operacional, a prévia
`/roteiro-da-aula-v2/` segue `noindex, nofollow`, os três flags de
escrita continuam `false`, e o agendamento de encerramento continua
sem efeito em produção.

## Etapa 6B — testes de autorização e correção administrativa (25/10/2026)

A homologação da etapa 6A passou em 16 workflows (PR #895, integrada).
Esta etapa acrescenta um segundo ensaio SQL, executado **após** o
cenário de presença/ausência/cancelamento e ainda dentro do mesmo
`BEGIN/ROLLBACK` no banco descartável do GitHub Actions.

O ensaio `teacher_v2_authenticated_admin_rehearsal.sql` cria uma
identidade fictícia do professor, insere-a na tabela de administradores
apenas no banco descartável e simula as reivindicações JWT e o papel
`authenticated` usado pela Data API do Supabase.

Verificações planejadas:
- professor autenticado consulta uma turma fechada;
- justificativa curta é recusada;
- ausência é corrigida com registro de auditoria e responsável;
- repetição da correção não gera nova alteração nem auditoria duplicada;
- o histórico consultável reflete a presença corrigida, preservando
  o instantâneo original para auditoria;
- gravação de apresentação e avaliação após o encerramento é recusada;
- aluno autenticado sem privilégio administrativo não consulta o
  histórico nem altera presenças.

A homologação só é considerada aprovada com CI completo; o ensaio não
executa ações em alunos reais nem altera mensalidades, cron ou flags.
Este recorte testa a segurança e a correção pós-encerramento, **não**
equivale ainda à validação de apresentação e avaliação bem-sucedidas,
reposição ou concorrência simultânea de sessões autenticadas.

**Próxima etapa:** ensaiar apresentação e avaliação reais com dados
sintéticos dentro da janela da aula, reposições e concorrência em
conexões separadas antes de qualquer ativação.

## Etapa 6C — apresentação, perguntas e reposição (25/10/2026)

Novo ensaio `tests/sql/teacher_v2_stage6c_live_rpcs.sql`, executado
com uma identidade administrativa sintética e dados fictícios, após
a homologação 6B e dentro da mesma transação `BEGIN/ROLLBACK`
do banco descartável.

Escopo do ensaio:
- Aula regular iniciada há cerca de 15 minutos e professor autenticado;
- registro de apresentação (lição 1) com confirmação de presença;
- avaliação de pergunta estudada e preservação da avaliação original
  em uma chamada repetida com nota diferente;
- apresentação e avaliação em uma reposição confirmada;
- pergunta inexistente recusada sem deixar presença parcial;
- verificação isolada do log privado de avaliações, ocorrências e
  ausência de encerramento da aula ainda em andamento.

As migrações existentes, a interface atual, as flags e o worker
continuam intactos. **O cenário de corrida entre duas conexões
PostgreSQL distintas ainda deve ser ensaiado separadamente**
antes da ativação. Nenhuma gravação foi feita em alunos reais.

## Etapa 6D — concorrência real entre conexões PostgreSQL (25/10/2026)

A etapa 6C validou requisições sequenciais numa única conexão. A etapa
6D acrescenta `scripts/test_teacher_v2_stage6d_concurrency.sh` ao workflow
`Validate Supabase baseline restore`, com dois processos `psql`
independentes contra um Supabase CLI **descartável**.

- A primeira sessão grava uma avaliação e mantém o bloqueio transacional.
- A segunda sessão tenta reavaliar a mesma pergunta com outra nota.
  O teste consulta `pg_locks` e exige que ela **esteja aguardando**
  o advisory lock, não apenas que as chamadas sejam sequenciais.
- Enquanto a primeira sessão mantém o bloqueio, o worker habilitado
  somente na cópia descartável precisa desistir sem fechar aulas.
- Após os dois commits, a nota original deve continuar registrada,
  com `already_rated=true` na segunda resposta e sem duplicação.
- A passagem seguinte do worker deve encerrar exatamente uma aula
  fictícia vencida, gerar uma ausência auditada e ser idempotente
  na repetição.
- A prova termina com o controle de encerramento desligado e
  verificações de frequência, avaliações e snapshots.

O ensaio usa identidades e turmas sintéticas. Não se conecta ao projeto
Supabase de produção, não modifica mensalidades, alunos reais, página
operacional, URLs ou flags de produção. O ambiente é destruído pelo
workflow, mesmo quando um teste falha.

**Critério para integração:** workflow completo aprovado. Esta
homologação de banco não substitui testes em navegador autenticado,
acessibilidade móvel, validação supervisionada e plano de reversão
necessários antes de ativar a v2.

## Etapa 7A — homologação visual em navegador, sem escrita (25/10/2026)

Adicionado ensaio em navegador Chromium com dados e identidades
**inteiramente fictícios**, executado por
`.github/workflows/teacher-v2-browser-homologation.yml`.
A página real `/roteiro-da-aula-v2/` e os scripts JavaScript reais
são carregados a partir do repositório, enquanto autenticação, respostas
do banco e apresentações são simuladas no próprio teste.

Cobertura exigida antes de promover a etapa:
- Visitante sem sessão é encaminhado a `/login/` antes de consultar turmas;
- Usuário autenticado sem privilégio é encaminhado a `/acesso-negado/`;
- Professor fictício navega entre apresentações, perguntas e turmas;
- Cancelamentos aparecem separados e os registros continuam bloqueados;
- Busca de perguntas estudadas e troca de data funcionam;
- Falha temporária de leitura pode ser recuperada pelo botão ATUALIZAR;
- Em viewport móvel de 375 px não existe transbordamento horizontal;
- O acesso ao roteiro antigo permanece explícito e funcional;
- A prévia mantém `noindex, nofollow` e não chama RPCs de escrita.

**Limitação deliberada:** o ensaio prova interatividade no Chromium,
mas não é uma sessão real de um professor contra o Supabase operacional.
A etapa 7B exige validação manual autenticada e somente leitura
em dispositivos reais antes de habilitar flags, automações ou trocar
qualquer entrada da área administrativa.

### Plano de retorno para a etapa 7B

O fallback permanente deverá ser a rota existente
`/roteiro-da-aula/`, que não é modificada por esta etapa.
Em caso de falha durante uma futura implantação, restaurar o link
administrativo antigo, desativar imediatamente os três controles de
escrita da interface v2 e definir
`private.academic_v2_automation_control.enabled=false`,
`enabled_from=null`, preservando registros auditados já existentes.
A ativação do worker será uma operação **separada**, aprovada apenas
após revisão do escopo e da data `enabled_from`.

## SEO

Ambas as rotas administrativas usam `noindex, nofollow`. Uma eventual
troca de URL deve manter esse controle e não poderá incluir páginas
administrativas no sitemap público. Informar ao responsável antes da troca.
