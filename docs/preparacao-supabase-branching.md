# Preparação para criação automática de branches no Supabase

O protocolo detalhado para backup, reversão e critérios de cutover está em
[supabase-migration-ledger-cutover-runbook.md](supabase-migration-ledger-cutover-runbook.md).
A transição continua bloqueada enquanto a restauração real e o teste de branch
remota não forem aprovados.

## Verificação da cadeia canônica descartável — 14/10/2026

A cadeia de reconstrução usada pelo CLI ganhou um bloqueio SQL executável
contra aplicação em bancos com tabelas existentes da plataforma de aulas.
O CI também confere os hashes do bundle das duas migrações isoladas,
compara o esquema reconstruído com o fingerprint revisado, verifica
jobs Cron desativados e exige falha controlada ao tentar executar o
bootstrap uma segunda vez em banco já preenchido com dados sintéticos.

Essa proteção é **somente uma verificação local**: não resolve a
divergência das versões registradas em `supabase_migrations` e não
autoriza substituir o diretório atual de migrações ou ativar
`Automatic Branching`. A próxima transição deve utilizar o relatório
`branching-cutover-plan.json` e exigir uma reconstrução remota completa,
após aprovação específica de custo e estratégia de rollback.

## Preparação do cutover canônico — 14/10/2026

A leitura mais recente do banco de produção encontrou **289 versões de
migrações**, da versão `20260804190024` à `20261013225440`.
Essas contagens são mais recentes do que o diagnóstico histórico abaixo.

A verificação completa do projeto por meio do GitHub Actions já comprovou
que o baseline canônico pode recriar o catálogo PostgreSQL em uma instância
descartável. **Isso não significa que o histórico nativo de migrações do
Supabase Branching esteja reconciliado.** A branch remota da PR #650
falhou durante a reconstrução automática; a PR #651 permanece pendente
de validação remota.

A Action `Supabase migration reconciliation` foi ampliada para produzir
dois artefatos de diagnóstico no `main`, usando a conexão protegida
`SUPABASE_DB_URL` e **somente leitura**:

- `migration-reconciliation.json`: comparação de timestamps, nomes e
  SHA256 calculados dentro do PostgreSQL, sem exportar os SQLs históricos.
- `branching-cutover-plan.json`: identificação da versão mais recente,
  contagem de divergências, digest do bootstrap canônico, pré-requisitos
  pendentes e sequência de validações. O plano nunca autoriza automaticamente
  reparos no ledger nem ativa `Automatic Branching`.

### Condições obrigatórias para qualquer transição de histórico

1. Preservar um backup recuperável e um registro imutável dos timestamps
   existentes, assim como a identidade dos arquivos atualmente publicados.
2. Não alterar, excluir ou renumerar migrações históricas no `main`.
   Não copiar instruções SQL antigas do banco para artefatos públicos:
   parte do histórico contém dados pessoais.
3. Construir uma cadeia de migrações **alternativa e isolada**, iniciada
   pelo bootstrap canônico consolidado, sem colocá-la no diretório produtivo.
   Comparar o fingerprint integral, RLS, Auth, triggers e Cron.
4. Definir um plano explícito para preservar o ledger de produção na
   transição. Não inserir entradas fictícias em
   `supabase_migrations.schema_migrations` apenas para passar nas comparações.
5. Validar a cadeia no Supabase CLI descartável e depois em uma branch
   hospedada, com integrações externas mockadas e custo aprovado.
6. Somente após uma branch remota íntegra, aprovar o procedimento de
   mudança do histórico de produção, incluindo reversão e auditoria.
7. Ativar `Automatic Branching` exclusivamente após uma nova prova
   de provisionamento e execução de testes de integração.

**O relatório de cutover é um diagnóstico, não um script de migração**.
Nenhum passo acima deve ser executado automaticamente sobre a produção.

## Estado verificado em 13/10/2026

A produção é o projeto Supabase `wnigzpvgsbpjdxvjzugt`, no plano Pro.
A branch de produção chama-se `main`. A criação automática ainda **não está
ativada** e não existe nenhuma preview remota ativa.

O catálogo de versões das migrações de produção contém 286 registros. O
repositório contém 237 arquivos SQL em `supabase/migrations/`. A comparação
por versão (não por conteúdo SQL) encontrou **180 correspondências, 106
versões sem arquivo Git e 57 arquivos sem versão correspondente na produção**.

Essas contagens são um diagnóstico do histórico, **não** uma indicação de que
faltam 106 tabelas, nem uma autorização para reproduzir migrações antigas.
A base foi parcialmente construída antes do histórico versionado no Git;
arquivos históricos posteriores também possuem versões diferentes das
registradas no banco. Entre os 57 arquivos sem correspondência de versão,\n**45 compartilham o nome** de uma migração remota, mas possuem timestamps\ndistintos; os outros 12 exigem investigação específica. Igualdade de nome\n**não comprova igualdade das instruções SQL**. A reconstrução que passou no GitHub utiliza o
`supabase/baseline/`, não a execução cronológica dos 237 arquivos SQL.

**Conclusão:** não habilitar `Automatic branching` até ser comprovada a
reconstrução de uma branch vazia. O caminho `supabase/migrations/` atual não
deve ser aplicado indiscriminadamente a um banco novo.

## Auditoria reproduzível, sem dados de alunos

A Action [Supabase branching readiness](../.github/workflows/supabase-branching-readiness.yml)
pode ser executada manualmente em GitHub Actions. A execução:

1. Busca **somente os identificadores de versão** na tabela
   `supabase_migrations.schema_migrations` da produção por uma consulta de leitura.
2. Compara essas versões aos nomes dos arquivos SQL do checkout protegido de
   `main`. Não lê nem publica instruções SQL de migrações antigas.
3. Verifica se existem `supabase/config.toml` e `supabase/seed.sql`.
4. Produz um relatório JSON sem dados pessoais. Retorna **BLOCKED** até que as
   divergências sejam resolvidas; `METADATA_ALIGNED` significa apenas que
   as versões coincidem, não que a branch é funcional.

A Action utiliza a credencial já configurada para a auditoria de drift
(`SUPABASE_DB_URL`), **somente no acionamento manual**. PRs executam apenas
os testes locais do detector, sem receber qualquer credencial de produção.

Também é possível executá-la localmente com um arquivo contendo exclusivamente
uma versão numérica de 14 dígitos por linha:

```bash
python3 scripts/check_supabase_branching_readiness.py \
  --production-versions-file ./versoes-do-supabase.txt \
  --report-json ./branching-readiness.json

python3 -m unittest discover -s tests -p test_supabase_branching_readiness.py
```

Não enviar as versões de produção como anexos públicos se o contexto exigir
confidencialidade; o próprio relatório resume apenas contagens e exemplos
de versões. Nunca exportar instruções SQL da tabela de migrações para um
repositório público: algumas migrações históricas contêm dados pessoais.

## Análise de identidade de migração (além dos timestamps)

O relatório inicial identifica 106 versões de produção sem arquivo Git e
57 versões Git sem registro em produção. Existem 45 nomes coincidentes
com timestamps diferentes e 12 arquivos com nomes sem equivalente remoto.

Para não confundir **mesmo nome** com **mesma instrução SQL**, acrescentamos
uma segunda auditoria: **GitHub Actions > Supabase migration reconciliation**.
Ela compara, sem extrair as instruções históricas do Supabase:

- version (timestamp numérico);
- name (identificador da migração);
- SHA256 da concatenação normalizada dos comandos, computado **dentro**
  do PostgreSQL e nunca publicado como texto SQL.

O workflow de PR só executa os testes de classificação. O workflow de
`main` executa a leitura com as credenciais já protegidas do GitHub.
O relatório classifica correspondências por versão, diferenças de corpo SQL,
versões distintas com o mesmo nome e cópias efetivamente idênticas por SHA256.
Um mesmo nome com SHA256 diferente **não** autoriza um `migration repair`.

O arquivo JSON publicado como artifact contém exclusivamente contagens e
amostras de **timestamps numéricos**, sem migração SQL, e-mails, dados de
alunos ou chaves. O job de classificação ter sucesso significa apenas que
a comparação foi executada corretamente. O estado
`RECONCILIATION_REQUIRED` é **bloqueante para habilitar Branching**.

Mesmo quando SQL e nomes coincidirem, não se deve renomear nem reexecutar
arquivos históricos: o checker de drift preserva sua imutabilidade no Git,
e o Supabase usa o número de versão como identidade. A mudança efetiva
exigirá escolher e validar uma estratégia de bootstrap em banco novo.

## Diagnóstico SHA256 confirmado — 13/10/2026

O primeiro exame real de todos os corpos SQL históricos, por hash calculado
dentro do Supabase, está registrado em
[GitHub Actions — Supabase migration reconciliation, run 38346530061](https://github.com/Zoqvera/teacherflavius/actions/runs/38346530061).
O job foi concluído com sucesso, mas seu resultado foi
`RECONCILIATION_REQUIRED`.

| Comparação | Ocorrências |
| --- | ---: |
| Mesma versão, mesmo nome e corpo SQL idêntico | 149 |
| Mesma versão e nome, corpo SQL diferente | 31 |
| Versão diferente, mesmo nome e corpo SQL idêntico | 33 |
| Versão diferente, mesmo nome, corpo SQL diferente | 12 |
| Migrações remotas sem equivalente pelo nome no Git | 61 |
| Migrações do Git sem equivalente pelo nome no remoto | 12 |

A auditoria produz **um manifesto numérico de versões**, incluído no
artifact JSON da execução, que relaciona os 33 pares com SQL idêntico,
os 12 pares com SQL diferente, as 31 versões com divergência de corpo
SQL e as 73 versões sem par identificado. Não publica os comandos SQL
antigos, hashes de senhas, nem registros de alunos.

**Critério de segurança:** correspondência por SHA256 atesta bytes
normalizados iguais; SHA256 diferente pode representar semântica diferente
ou meras diferenças de formatação e **não** autoriza ajuste automático
de histórico. Mesmo os 33 pares idênticos não devem ser corrigidos
renomeando arquivos Git, pois o repositório impõe imutabilidade histórica.

A próxima intervenção efetiva requer avaliar um bootstrap canônico
reconstrutível, preservando o ledger atual da produção até que a
simulação em banco vazio seja aprovada e exista um plano de rollback.
Não trocar o conteúdo/ordem das migrations remotamente por tentativa
e erro. A integração nativa de Branching permanece desativada.

## Plano de reconciliação

### Etapa A — diagnóstico e cópia de segurança (sem alterações em produção)

- Verificar nova execução de backup criptografado e restauração independente.
- Preservar um manifesto do esquema e do histórico remoto para uso privado.
- Agrupar as 106 versões ausentes por período e dependências; classificar
  separadamente as 57 versões locais que não estão na produção.
- Descobrir **quais objetos foram criados fora das migrations**, sem copiar
  dados privados e sem inferir que os nomes de arquivos são intercambiáveis.

### Etapa B — migrar para uma reconstrução canônica

- Elaborar uma estratégia de **bootstrap/squash consistente com a produção**.
  Reconciliar a cadeia histórica sem alterar arquivos já aprovados nem
  aplicar novamente migrations históricas sobre o banco de produção.
- Testar a estratégia num PostgreSQL/Supabase descartável com Auth, RLS,
  grants, extensões, RPCs, triggers, Cron e tabelas privadas.
- Comparar estrutura restaurada com fingerprint de produção. Verificar
  criação de contas sintéticas, fluxo de cobrança fictícia e ausência de
  permissões ampliadas; não usar dados reais.
- Somente se comprovado seguro, planejar o ajuste do ledger de migrações
  remoto com plano de rollback e autorização específica do professor. Reparar
  o ledger sem validar a reconstrução **não** resolve a causa-raiz.
- Confirmar no teste que a migration bootstrap **não será executada na
  produção**, que já contém esses objetos.

### Etapa C — preparar a preview remota e as integrações

- Criar `supabase/config.toml` pelo CLI, mantendo segredos apenas em
  variáveis `env()`, e `supabase/seed.sql` com **dados fictícios**.
- Rever cada job `cron.job`, Edge Function e segredo na branch antes de
  qualquer ensaio. Remover acesso a credenciais de produção; usar mocks,
  e-mails de teste e pagamentos sandbox. Cron/Web Push externos devem
  ficar inertes na preview, inclusive durante a criação do banco.
- Testar uma única branch efêmera com nome `pr-<numero>-teste`, após
  conferência do custo e confirmação do professor.
- Verificar a saúde do projeto, migrações aplicadas, permissões, RLS e
  isolamento efetivo. Não usar `project_ref` de produção nos testes.
- Excluir a branch após teste e confirmar sua remoção.

### Etapa D — integração GitHub (somente após Etapas A–C)

Em **Supabase Dashboard > Project Settings > Integrations > GitHub Integration**:

- **Repository:** `Zoqvera/teacherflavius`
- **Working directory:** `.`
- **Production branch:** `main`
- **Automatic branching:** ativar quando a reconstrução estiver validada
- **Supabase changes only:** ativar inicialmente para limitar branches
  automáticas aos PRs com alteração em `supabase/`
- **Deploy to production:** manter desativado inicialmente

A opção **Supabase changes only** não cria automaticamente uma branch para
uma PR que modifique só `auth.js`, `mensalidades.js` ou outra lógica fora
de `supabase/`. O contexto `isolated-preview-gate` foi descontinuado
por solicitação do proprietário. Testes remotos permanecem recomendados
para alterações sensíveis, mas a ausência deles não impede automaticamente
o merge. Para retirar a exigência cadastrada no GitHub, remova esse contexto
da regra nº `24970258` em **Settings > Rules > Rulesets**.

Após habilitar a integração, verificar que o Supabase publica o check
`Supabase Preview`. Torná-lo obrigatório somente quando o evento gerar
esse check em todas as PRs cobertas pela regra, para não bloquear PRs
puramente documentais. Não voltar a exigir um check de preview sem a decisão explícita
do proprietário e sem uma estratégia de provisionamento viável.

**Não executar** `supabase branches merge` separadamente se o fluxo
selecionado já aplicar automaticamente as migrations ao fazer merge do
GitHub. Isso pode duplicar mudanças.

## Segurança e custos

Branches não copiam dados da produção por padrão. São instâncias próprias,
com custo de computação a partir de US$ 0,01344 por hora para Micro, além
de possível uso de disco, rede e recursos externos. Branching Compute não
é coberto pelo Spend Cap nem abatido pelos créditos de computação Pro.
Antes do teste remunerado, apresentar o custo e pedir autorização.

A regra GitHub nº `24970258` foi configurada anteriormente para exigir
`isolated-preview-gate`. Ela precisa ser editada em
`Settings > Rules > Rulesets` para remover esse contexto. Durante a
transição, o workflow publica apenas avisos sobre a preview, mantendo o
contexto exigido até a atualização manual da ruleset. **Não** registrar
links falsos ou valores `PASS` fictícios. Migrações corretivas continuam
sujeitas aos contratos, controles de drift e verificações de segurança
independentes da preview remota.

Esta preparação não muda o conteúdo público do site nem suas configurações
de SEO.

## Referências oficiais

- [Supabase GitHub Integration](https://supabase.com/docs/guides/deployment/branching/github-integration)
- [Supabase Branching](https://supabase.com/docs/guides/deployment/branching)
- [Por que branches ficam vazias](https://supabase.com/docs/guides/troubleshooting/new-branch-doesnt-copy-database)
- [Recuperação de falhas de migrations em branches](https://supabase.com/docs/guides/troubleshooting/branch-in-migrations-failed-status)
- [Preços e uso de Branching](https://supabase.com/docs/guides/platform/manage-your-usage/branching)
