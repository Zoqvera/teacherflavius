# Apresentações das lições — Etapa 5B: implantação produtiva controlada

Data: 17/10/2026. A interface do aluno e do professor permanece bloqueada até validação pós-DDL.

## Justificativa da estratégia

O histórico do Supabase tem 316 migrações, com ponta `20261017110321`.
O diretório versionado do repositório **não espelha** integralmente esse
histórico: existem versões apenas na produção e arquivos locais que ainda
não foram aplicados. Portanto, `supabase db push` em lote e
`migration repair` não são procedimentos seguros nesta etapa.

O comando MCP `apply_migration` gera versões remotas próprias; sua
utilização criaria versões sem arquivos locais correspondentes. A
implantação utiliza, em vez disso, uma transação PostgreSQL única,
com guarda do baseline e `INSERT` das duas versões **canônicas** na
tabela de migrações, na mesma transação do DDL correspondente. Não
executa nenhuma outra migração do diretório.

## Evidências obrigatórias

- Backup criptografado aprovado: execução GitHub Actions `39043019631`.
- Restauração integral e ensaio das duas migrações aprovados: `39043160705`.
- O workflow seleciona automaticamente o último ensaio de recuperação
  bem-sucedido e seu artefato `supabase-recovery-report-<ID>`; ele precisa
  conter `presentation_schema_rehearsal: passed` e ter menos de 24 horas.
- A origem dos dois workflows é validada na API do GitHub antes da escrita.
- Preflight do PostgreSQL exige exatamente 316 migrações, a versão
  `20261017110321` na ponta, dependências conhecidas e ausência de
  qualquer implantação parcial da funcionalidade.

## Implantação

O workflow `.github/workflows/lesson-presentations-stage5b-production.yml`
não executa migrações ao integrar a PR. Deve ser iniciado **manualmente**
pelo GitHub Actions, na branch `main`, com a confirmação
`CONFIRMO_APRESENTACOES_5B`. Reexecuções não reaplicam as migrações,
porque o preflight bloqueia catálogos diferentes do estado original.

O script `scripts/sql/lesson_presentations_stage5b_transactional_rollout.sql`
carrega **somente**:

1. `20261017133000_lesson_presentations_stage1.sql`.
2. `20261017144500_lesson_presentation_views_stage3.sql`.

O `psql` executa ambos em uma só transação (`--single-transaction`,
`ON_ERROR_STOP=1`). Uma falha em qualquer DDL, metadado, permissão,
gatilho ou pós-condição aborta e reverte as duas migrações **e os
registros do ledger**.

O pós-teste SQL verifica 318 entradas de migração, três tabelas com
RLS, seis políticas, dois gatilhos de revisão, ausência de privilégios
anônimos, proteção contra escrita no horário do recibo e contagem
inicial zero em todas as novas tabelas.

**Atenção:** a implantação é aditiva. Não apaga apresentações,
mensalidades nem tabelas existentes. Em caso de falha após o commit,
não excluir as três tabelas: preservar os dados para diagnóstico.

## Após aplicar o DDL, antes de ativar

1. Confirmar saída de sucesso do workflow e histórico real no Supabase.
2. Validar limites de `authenticated`, `anon`, professor e aluno
   usando contas fictícias, além da disponibilidade real da Data API.
3. Homologar envio, edição, versão concorrente, histórico, recibo de
   leitura e nova edição pelo navegador e pelo aplicativo.
4. Criar PR separada para alterar simultaneamente
   `lesson_presentation_editor.js` e
   `teacher_lesson_presentations.js` de `false` para `true`.
5. Integrar apenas após CI completo e plano de reversão dos dois
   flags; manter as tabelas em caso de reversão de interface.

Sem confirmação de qualquer passo, **os dois componentes continuam
desativados**. Não declarar a funcionalidade liberada apenas por
concluir a criação das tabelas.

## SEO

O pacote altera infraestrutura de deploy, testes e documentação. Não
altera páginas públicas, títulos, canonicals, sitemap nem
`robots.txt`. As páginas autenticadas de aluno e professor continuam
com `noindex,nofollow`. **Nenhuma alteração de SEO nesta etapa.**
