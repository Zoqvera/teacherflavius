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

## SEO

Ambas as rotas administrativas usam `noindex, nofollow`. Uma eventual
troca de URL deve manter esse controle e não poderá incluir páginas
administrativas no sitemap público. Informar ao responsável antes da troca.
