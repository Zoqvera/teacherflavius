# Bootstrap canônico do Supabase — protótipo descartável

A reconstrução canônica agora pode ser compilada em **um único arquivo SQL**,
a partir dos 78 overlays já revisados e executados pelo workflow
`.github/workflows/validate-supabase-baseline.yml`. A ordem é extraída da
fonte de verdade existente, sem copiar ou substituir as migrations históricas.

## Configuração versionada preparada

A raiz do repositório agora contém `supabase/config.toml` e
`supabase/seed.sql`. O `project_id` no TOML é um nome **local**, não a
referência do Supabase produtivo. O `[db.seed].enabled` permanece `false`
por padrão.

O seed versionado contém apenas duas turmas fictícias (`970001` e
`970002`) e recusa a execução se detectar dados de turmas, alunos,
mensalidades ou jobs Cron ativos. Não cria contas de autenticação,
pagamentos, e-mails nem contatos de alunos.

A Action `Supabase CLI-native branching rehearsal` utiliza **cópias
descartáveis** do `config.toml` e do `seed.sql`: habilita o seed
**somente nessa cópia**, após preparar o bootstrap consolidado e
desativar Cron. O repositório nunca ativa o seed para produção ou uma
preview remota por padrão.

**Não execute** `supabase start`, `supabase db reset` ou `supabase db push`
diretamente no diretório original do repositório. O diretório legado
`supabase/migrations/` ainda não representa uma cadeia segura de
reconstrução. Use os fluxos descartáveis do GitHub, que constroem os
artefatos em `$RUNNER_TEMP`. Uma branch remota só deve ser criada
após a reconciliação do histórico, com consentimento sobre o custo e
as integrações externas isoladas.

## Limite de segurança

**Este bundle não é uma migração para produção.** Ele cria objetos que já
existem no Supabase produtivo, inclui agendamentos Cron e requer um banco novo
com os esquemas de plataforma do Supabase presentes. Nunca aplicar à produção
nem colocar em `supabase/migrations/` enquanto o ledger não estiver
reconciliado. A ferramenta recusa gravar o bundle nesse diretório.

Os objetos criados representam a reconstrução versionada atual, mas sua
equivalência funcional com uma **branch remota criada pela integração do
Supabase** ainda não está comprovada.

## Compilação determinística

Em um ambiente de desenvolvimento sem segredos reais:

```bash
python3 scripts/compile_canonical_supabase_bootstrap.py \
  --output /tmp/teacherflavius-bootstrap-disposable.sql \
  --manifest /tmp/teacherflavius-bootstrap-manifest.json \
  --fingerprint-sql /tmp/teacherflavius-fingerprint.sql
```

O manifesto registra os SHA256 de todos os overlays e do pacote final. A
consulta de fingerprint é a mesma usada pelo CI de recuperação. A operação
apenas lê o repositório e grava arquivos temporários; não conecta ao Supabase.

A Action **Canonical Supabase bootstrap replay**:

1. Executa testes unitários de ordem, integridade e restrição ao diretório.
2. Compila um único arquivo SQL a partir dos 78 overlays.
3. Inicializa um Supabase local descartável, **sem executar os arquivos
   históricos** e sem importar `auth.users`, `profiles` ou dados financeiros.
4. Executa o bundle por uma única sessão de `psql`.
5. Cria apenas valores Vault fictícios, sem chaves reais.
6. Compara o catálogo resultante com `schema-fingerprint.json` (tabelas,
   funções, políticas RLS, triggers, Cron, Vault etc.).
7. Assegura ausência de alunos, mensalidades e turmas matriculadas e testa
   que papéis do navegador não receberam permissões de `TRUNCATE`.
8. Exclui o ambiente descartável ao terminar, inclusive quando falhar.

Esse teste **não** valida integrações externas (Mercado Pago, e-mail, Web Push)
nem garante que Cron não tente rodar dentro de uma branch remota. Portanto,
qualquer piloto remoto requer uma configuração segura de Cron, Vault e funções,
além de autorização prévia do custo.

## Ensaio de migrações nativas pela CLI (sem custo de branch remota)

O workflow `.github/workflows/supabase-cli-replay.yml` executa o próprio
mecanismo `supabase start` e `supabase db reset --local`, usando um projeto
descartável situado fora do checkout. Não utiliza a sequência antiga das
migrações do repositório nem altera `supabase/migrations/`.

O script `scripts/prepare_supabase_cli_replay.py` produz exclusivamente
dentro desse projeto efêmero:

- Uma migração inicial única com o bootstrap compilado dos 78 overlays.
- Uma segunda migração que comprova a ordem e verifica a existência das
  tabelas críticas.
- Um `seed.sql` sintético de duas turmas, sem contas, CPF, pagamentos ou
  números de contato reais.
- Uma guarda executada na mesma migração inicial que coloca **todos os Cron
  jobs como inativos**, impedindo despachos por agendamento no teste.

O CI confere o ledger aplicado pela CLI, a presença de apenas duas turmas
fictícias, a ausência de perfis/mensalidades, a desativação dos jobs e o
fingerprint de catálogo. Por fim executa `supabase db reset --local` para
comprovar que a migração e o seed funcionam novamente em uma instância limpa.
O ambiente é destruído ao término, mesmo se houver falhas.

**Limitação:** esse ensaio demonstra compatibilidade com o ciclo local de
migrações da CLI; não é prova de que as branches do Supabase hospedado
aceitarão o ledger de produção atual. Os identificadores temporários das
duas migrations NÃO são publicados em `supabase/migrations/` e nunca devem
ser cadastrados em produção. O ambiente remoto só será ensaiado depois de
concluir o plano de migrações/ledger e autorizar seu custo.

## Próximo passo: compatibilidade com Supabase Branching

Para que a integração GitHub consiga usar o bootstrap, ainda será necessário:

- definir uma estratégia de versões que preserve o ledger de produção e
  impeça que as migrations históricas sejam executadas após esse bundle;
- validar o mecanismo de provisionamento real de branches a partir de um
  histórico alinhado, com migrações posteriores incrementais;
- separar configuração e seeds fictícios de produção, incluindo proteção
  contra Cron/Web Push e provedores financeiros;
- verificar se o Supabase consegue provisionar uma branch remota com a
  estrutura correta, **antes** de ativar Automatic Branching.

Não executar `migration repair` em lote nem alterar objetos/ledger de produção
apenas com base nos hashes. Consulte o
[plano de preparação](../../docs/preparacao-supabase-branching.md).
