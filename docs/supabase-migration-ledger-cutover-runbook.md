# Protocolo de transição e reversão do histórico de migrações do Supabase

**Projeto:** Teacherflavius.com  
**Natureza:** roteiro de revisão, sem autorização para escrita em produção.  
**Estado:** BLOQUEADO até aprovação de todos os pré-requisitos.

## Diagnóstico atualizado — 17/10/2026 (somente leitura)

A verificação direta encontrou **314 migrações no Supabase de produção**
e **265 arquivos SQL** em `supabase/migrations/` da `main`.
Pelo identificador de versão, há 197 correspondências, 117 versões
registradas somente na produção e 68 arquivos somente no Git.
Essa comparação nao comprova equivalencia do corpo SQL. Estes dados
substituem as contagens históricas de 289 / 237 mencionadas adiante.

A tentativa autorizada de criar a branch remota
`lesson-presentations-stage1-validation` em 16/10 terminou com
`MIGRATIONS_FAILED`. A branch estava sem as tabelas fundamentais
`public.profiles` e `public.study_lesson_pages` apos a falha.
Foi posteriormente excluida; a exclusao foi confirmada, evitando custo
de computacao persistente. Esse resultado **não valida** a reconstrução do
schema completo, embora testes sintéticos da migração de apresentações
tenham passado em um subconjunto de estruturas fictícias.

A leitura agregada de `supabase_migrations.schema_migrations`, sem
exportar `statements`, nao encontrou declaracoes explicitas de
`CREATE TABLE public.teacher_admins` nem da tabela base
`public.profiles` sob o padrao conservador de reconhecimento.
Ela encontrou uma declaracao para `study_lesson_pages`. A ausencia
de correspondencia textual e um **indicador**, nao prova definitiva:
DDL dinâmica, aspas ou expressões variantes podem nao ser identificadas.
Por outro lado, `teacher_admins` e referenciada em multiplos registros
do historico, o que requer analisar o ponto exato de falha do replay.

Ha dois mecanismos distintos:
- Branch criada no **Dashboard/API**: reproduz o historico SQL da
  propria produção (`supabase_migrations.schema_migrations`).
- Branch vinculada ao **GitHub**: reproduz os arquivos de migrations
  do repositorio. Uma cadeia canônica descartável, fora do diretório
  histórico, não corrige nenhum desses mecanismos automaticamente.

A Action `Supabase migration reconciliation` consulta as declaracoes de
fundação **dentro do PostgreSQL** e publica somente contagens e indicadores
no artefato `branch-foundation-assessment.json`. O status
`POSSIBLE_MISSING_FOUNDATION` indica bloqueio de diagnóstico;
`FOUNDATION_DECLARATIONS_DETECTED` não comprova replay, segurança
ou autorização para executar mudanças. Os dados SQL originais e
registros de alunos nunca são exportados para Actions.

**Próxima investigação segura:** consultar os logs da etapa `migrate`
de uma branch com erro **antes de excluí-la**, identificar o primeiro
comando que falhou, comparar as dependências do bootstrap com a produção
sem expor o SQL histórico e construir uma cadeia alternativa isolada.
Uma nova branch remota com custo exige autorização de custo.
O eventual `migration repair` do ledger produtivo exige ainda backup
restaurável e aprovação específica; não decorre deste relatório.

Documentação Supabase:
https://supabase.com/docs/guides/deployment/branching/dashboard
https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status

## ETAPA 1C — Inventário estrutural de objetos (17/10/2026)

O inventário da produção foi consultado diretamente em modo **somente leitura**.
A consulta retornou **3.134 identificadores estruturais**, organizados assim:
1.383 colunas, 724 restrições, 223 índices não associados a constraints,
120 políticas RLS, 129 relações públicas/privadas (incluindo views),
461 rotinas e 94 triggers públicos/privados. Nenhum registro de aluno,
conteúdo de função, segredo Vault ou instrução de migração foi retornado.
A extração é um retrato temporal e deve ser repetida ao longo do projeto.

O esquema canônico versionado ainda é uma reconstrução parcial. Na última
comparação por **contagens públicas**, apresentava 52 tabelas públicas,
192 funções públicas e 95 políticas RLS, enquanto a produção apresentava
96 tabelas públicas, 369 funções públicas e 120 políticas RLS.
As métricas não medem equivalência de definição, dependência ou privilégio.

O workflow `Supabase canonical object inventory` acrescenta:
- Testes de contrato na PR, **sem credenciais da produção**;
- após o merge, em `main`, Supabase CLI local e descartável reconstruído a
  partir dos overlays canônicos, com Cron desativado e seed fictício;
- a mesma consulta de catálogo nos bancos local e produtivo, retornando
  exclusivamente `tipo\tidentificador\tSHA256(ddl_metadata)`;
- comparação de objetos faltantes, extras e definições divergentes por
  tipo e amostras limitadas, sem publicar as definições SQL, dumps ou
  documentos privados;
- o artefato `supabase-schema-object-gap-assessment` (retido por 14 dias)
  armazena apenas números e, no máximo, 15 nomes estruturais por categoria.

**Critério de aceitação:** um resultado `SCHEMA_OBJECTS_ALIGNED` é apenas
uma evidência de equivalência dos objetos cobertos pela consulta, e não
aprovação de implantação. Também é obrigatório conferir extensões, grants
globais, Auth, Cron inerte, funções externas, email, pagamentos, backup e
restauração em ambiente independente. Divergências em hashes devem ser
inspecionadas antes de gerar overlays incrementais; nunca copiar ou
publicar SQL histórico. Não usar `migration repair` ou reconstruir o
projeto real como atalho.

**Plano de transição segura:**

1. **Diagnosticar:** gerar inventário de `main` protegido e classificar
   diferenças por objeto, incluindo dependências prévias como
   `profiles` e `teacher_admins`.
2. **Completar o bootstrap descartável:** propor overlays faltantes em
   PRs independentes, testando cada adição sobre um banco vazio. Nunca
   sobrescrever migrações históricas ou converter os overlays em
   migrações produtivas por simples cópia.
3. **Verificar integridade:** ensaiar RLS, Auth, Cron desativado, grants,
   exclusão de aluno, aulas, inscrições, cobranças e pagamentos fictícios.
4. **Restaurar fora da produção:** confirmar backup recente, obter
   autorização para eventual projeto adicional e comprovar restauração
   independente, preservando Auth e histórico SQL privado.
5. **Testar branching remoto:** criar uma única branch temporária **após
   consentimento de custo**, verificar o primeiro erro de migração pelos
   logs e destruir o ambiente após os ensaios.
6. **Planejar cutover:** somente então propor mapeamento de versões,
   snapshots privados, rollback e janela de manutenção com autorização
   explícita antes de qualquer escrita na produção.

Os controles acima não afetam páginas públicas, URLs, robots, canonical
nem metadados de SEO.

## Fronteira de segurança

A produção mantém o histórico original em
`supabase_migrations.schema_migrations`. Em 14/10/2026, a consulta de leitura
identificou **289 versões**, com a última `20261013225440`. O GitHub
contém migrações históricas com divergências de versão e conteúdo. O
bootstrap canônico de 78 overlays reconstrói um banco **vazio** em
ambiente descartável, mas não substitui o histórico produtivo e não
comprova, sozinho, que o Supabase Branching remoto funciona.

**Não executar** `supabase migration repair`, `supabase db push`,
`supabase db reset`, alterações diretas na tabela de migrações,
`restore_project` ou `Automatic Branching` contra o banco produtivo
durante a etapa de diagnóstico.

A PR #651 introduz `supabase/config.toml` e `supabase/seed.sql`
somente para ensaios locais descartáveis. A integração desse preparo
não equivale a uma preview remota aprovada e não libera Automatic
Branching, a transição do ledger ou escrita no banco de produção.

## Auditoria de catálogo real em 14/10/2026

Uma consulta PostgreSQL **somente leitura**, no projeto de produção, identificou
divergência expressiva entre o esquema existente e a captura histórica
`supabase/baseline/schema-fingerprint.json`. Os números se referem ao
catálogo de objetos, não a registros de alunos.

| Métrica | Captura do baseline | Produção | Diferença |
| --- | ---: | ---: | ---: |
| Tabelas públicas | 52 | 81 | +29 |
| Constraints públicas | 266 | 438 | +172 |
| Índices públicos sem constraint | 116 | 172 | +56 |
| Funções públicas | 190 | 344 | +154 |
| Funções privadas | 37 | 82 | +45 |
| Políticas RLS públicas | 95 | 107 | +12 |
| Triggers públicos | 47 | 79 | +32 |
| Triggers de Auth da aplicação | 1 | 2 | +1 |
| Event triggers da aplicação | 1 | 1 | 0 |
| Jobs Cron identificados | 2 | 2 | 0 |
| Buckets Storage | 0 | 0 | 0 |
| Nomes de segredos Vault esperados | 3 | 3 | 0 |

A captura de baseline foi marcada como versão `20261013143000`; o
ledger real de produção está atualmente na versão `20261013225440`.
A diferença **não comprova, por si só**, que os 29 objetos extras sejam
alterações ocorridas após essa versão: o baseline pode estar incompleto
desde a extração anterior. É necessário comparar as identidades e definições
de objetos antes de selecionar um plano de reconstrução.

Foi comprovado, por busca de arquivos no Git, que algumas tabelas produtivas,
como `payment_chargebacks`, `payment_analytics_outbox` e
`marketing_acquisition_events`, são criadas em migrações históricas,
mas não aparecem entre os overlays de reconstrução consultados.
A migração desses objetos precisa contemplar também dependências,
triggers, políticas e permissões, e não apenas `CREATE TABLE`.

O workflow protegido `Supabase migration reconciliation` agora inclui a
consulta `scripts/sql/supabase_catalog_fingerprint_readonly.sql` e o
comparador `scripts/compare_supabase_schema_fingerprint.py`.
A execução em `main` salva apenas as **contagens divergentes** no artefato
`schema-fingerprint-comparison.json`; não exporta linhas do banco,
segredos ou SQL histórico. `SCHEMA_COUNTS_ALIGNED` não significa equivalência
integral, backup recuperável ou autorização para alterar produção.
`SCHEMA_DRIFT_DETECTED` é um **impedimento operacional** para confiar no
baseline como imagem completa de produção. A auditoria não reconfigura as
proteções existentes nem mascara resultados de CI.

A interface conectada do Supabase utilizada na verificação não expõe a
listagem de backups agendados nem a restauração independente. Portanto,
**não há evidência de backup/restauração aprovada**. Verificar em
`Database > Backups` do Dashboard e manter evidências privadas.
O Supabase documenta backups diários do plano Pro, com retenção de
até sete dias; isso não atesta que uma cópia específica foi concluída.
A restauração da produção diretamente nela geraria indisponibilidade e
não é um teste seguro. Nunca usar a função de restauração no projeto ativo
para atender a este protocolo.

## Ponto de restauração: pré-requisitos

Antes de qualquer transição efetiva, o operador responsável precisa confirmar
e registrar, em um local **privado com acesso restrito**:

1. **Backup íntegro:** último backup diário concluído do Supabase Pro,
   horário da cópia, método físico ou lógico e período de retenção. O plano
   Pro disponibiliza backups diários; isso não significa que PITR esteja
   contratado ou ativado.
2. **Teste real de restauração:** restaurar uma cópia **separada** do backup,
   com integrações externas e Cron desativados, para demonstrar leitura do
   esquema, das contas Auth e dos dados. Registrar duração e limitações da
   restauração. Esse procedimento pode gerar custos e exige autorização
   específica antes de criar outro projeto.
3. **Exportação privada do histórico completo:** preservar todas as colunas
   da tabela de migrações, incluindo `statements`, `rollback`,
   `created_by` e `idempotency_key`. Esses campos podem conter dados
   pessoais ou segredos antigos e **nunca** devem aparecer em PRs, logs,
   artefatos de Actions ou chats. Um SHA256 de metadados não pode recriar
   as instruções SQL originais.
4. **Identidade do esquema:** registrar o fingerprint das estruturas,
   políticas RLS, funções, triggers, permissões, Auth, Cron e Vault;
   verificar separadamente arquivos do Storage e configurações que
   backups de banco não incluem.
5. **Condição operacional:** congelar alterações concorrentes de migrações,
   definir responsável pela execução e reversão, janela de manutenção,
   limite de indisponibilidade e validações antes/depois.
6. **Procedimento de retorno:** especificar o ponto de restauração
   utilizável, a sequência de reativação de autenticação, agendamentos e
   integrações, e como reconciliar transações legítimas feitas depois
   do backup. Não presumir que restaurar um backup antigo preserva
   pagamentos ou matrículas criados posteriormente.

A referência para cópias e limitações de restauração é a documentação oficial:
https://supabase.com/docs/guides/platform/backups e
https://supabase.com/docs/guides/platform/clone-project .

## Três evidências distintas

**A. Identidade do ledger, somente leitura**

A Action `Supabase migration reconciliation`, executada sobre `main`,
calcula os hashes SQL dentro do PostgreSQL e gera
`migration-ledger-attestation.json`. Ele contém contagem, primeira e
última versão, hash SHA256 de todas as identidades
`(version,name,hash SQL)` e sinalização de que **não foi executado
restore algum**. O relatório pode detectar drift ao comparar uma captura
anterior com outra pelo utilitário
`scripts/attest_supabase_migration_ledger.py`. Ele **não**
contém instruções SQL nem serve como backup.

**B. Transação e reversão simuladas em PostgreSQL**

A Action executa
`tests/fixtures/supabase_synthetic_ledger_rollback.sql` contra um
serviço PostgreSQL **descartável**, sem credenciais de produção.
O ensaio cria uma tabela fictícia com as mesmas seis colunas usadas
pelo ledger real, registra duas migrações artificiais, simula
exclusão, atualização e inclusão indevidas, executa `ROLLBACK` e
compara em ambos os sentidos todos os registros e seus arrays SQL.
Se faltar uma única coluna ou instrução, o teste falha.

A aprovação desse ensaio demonstra apenas a semântica de rollback
**dentro de uma transação do PostgreSQL**; não comprova que uma
operação CLI `migration repair` já confirmada em produção poderá
ser desfeita com `ROLLBACK` retroativo.

**C. Recuperação do banco completo**

Somente um teste real de restauração de backup em um projeto separado
pode comprovar a recuperabilidade do banco de produção e a janela de
perda de dados (RPO/RTO). Isso deve ser verificado
**separadamente** do ensaio sintético e do fingerprint de metadados.

## Estratégia de transição proposta (não executada)

**Fase 1 — diagnóstico aprovado.** Validar o resultado completo de
`branching-cutover-plan.json`, relacionar versões divergentes e
manter as migrações antigas imutáveis no Git. Identidades
divergentes não podem ser reconciliadas somente pelo nome.

**Fase 2 — candidato canônico em isolamento.** Produzir a cadeia a
partir dos 78 overlays e executar replay/fingerprint local, RLS,
Auth, Cron desativado e testes de matrícula, pagamento e reposição
com dados sintéticos. Não colocá-la no diretório histórico do
`main` antes de desenhar a transição do ledger.

**Fase 3 — recuperação comprovada.** Após autorização de custo,
testar a restauração para um projeto separado, em conjunto com
verificação independente do ledger completo, sem copiar dados
reais para branches de desenvolvimento.

**Fase 4 — validação remota.** Criar uma branch remota isolada,
com integrações bloqueadas, para validar exatamente o formato e a
sequência que o Supabase Branching executará. Não usar dados reais
no seed e não presumir equivalência com o teste local.

**Fase 5 — decisão de transição.** Só com as quatro fases
anteriores aprovadas, apresentar uma proposta de mudança precisa,
com versões e operações esperadas, janela, responsáveis, snapshot
privado verificável, rollback e custo. A execução dependerá de
**autorização específica**, não desta PR nem da aprovação de testes.

## Gatilhos de abortar e critérios de sucesso

**Abortar** se houver backup não verificado, SQL histórico
incompleto, drift no fingerprint, novas migrações concorrentes,
Cron ou webhooks externos ativos no ambiente de teste, divergência
de Auth/RLS, inconsistência financeira ou indisponibilidade de
restauração.

**Sucesso final**, ainda não atingido, requer:
- cadeia canônica íntegra, com testes locais aprovados;
- captura privada completa do ledger antes da transição;
- restauração real testada em destino independente;
- branch remota recriada com sucesso e sem dados reais;
- operações documentadas, janela aprovada e rollback conferido;
- testes remotos efetivos com dados sintéticos e evidência verificável
  antes de qualquer alteração do ledger de produção (sem depender do gate
  `isolated-preview-gate`, descontinuado por decisão do proprietário);
- autorização explícita para qualquer operação de escrita em produção.

Até esse ponto, **Automatic Branching permanece desativado**.

## SEO

Este procedimento trata exclusivamente de infraestrutura de banco e
testes; não altera páginas públicas, URLs, metadados, sitemap, robots
ou canonical.


## ETAPA 1D.2 - diagnostico das politicas RLS

O workflow protegido `Supabase canonical object inventory` passa a gerar `rls-posture-assessment.json` e diferencia mudancas de papeis/comandos das diferencas nos predicados `USING` e `WITH CHECK`. A consulta retorna exclusivamente nomes de politicas, papeis, comandos e hashes SHA256 das expressoes. A CI publica apenas contagens e amostras limitadas de identificadores.

As diferencas encontradas nao autorizam alterar autorizacoes em producao nem demonstram equivalencia funcional. Possiveis ampliacoes de acesso exigem revisao prioritaria e testes com contas ficticias. PRs nao recebem credenciais de producao; a consulta comparativa acontece apenas no workflow protegido da branch principal. Permanecem bloqueados o ajuste do ledger produtivo e a PR #776 ate verificacao completa.
