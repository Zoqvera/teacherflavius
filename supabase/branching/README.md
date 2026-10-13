# Bootstrap canônico do Supabase — protótipo descartável

A reconstrução canônica agora pode ser compilada em **um único arquivo SQL**,
a partir dos 75 overlays já revisados e executados pelo workflow
`.github/workflows/validate-supabase-baseline.yml`. A ordem é extraída da
fonte de verdade existente, sem copiar ou substituir as migrations históricas.

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
2. Compila um único arquivo SQL a partir dos 75 overlays.
3. Inicializa um Supabase local descartável, **sem executar os 237 arquivos
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
