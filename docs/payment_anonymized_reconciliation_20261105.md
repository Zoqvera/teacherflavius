# Reconciliação de pagamentos de titulares anonimizados — 05/11/2026

## Incidente

Dois pagamentos aprovados e já contabilizados em agosto (R$ 99,90 cada)
originaram os alertas `reconciliation_failure` às 20h55 e 21h05 e o
`financial_health_check` degradado às 20h58, horário de Brasília.

A consulta produtiva confirmou que ambas as mensalidades existem, estão
quitadas e possuem o mesmo `subject_ref` das respectivas tentativas. Os
dois lados têm `student_id = NULL`, como ocorre após anonimização. O
comparador `tuition.student_id = attempt_row.student_id` não corresponde
quando ambos são nulos, causando o erro enganoso "Mensalidade vinculada
não encontrada".

## Correção

- Preservar a comparação por `student_id` para alunos identificados.
- Permitir correspondência dos registros anonimizados **somente** quando
  ambos os IDs de aluno são nulos, `subject_ref` da tentativa é não nulo,
  o valor de `subject_ref` coincide e o ID da mensalidade coincide.
- Preservar os bloqueios por divergência de valor/identificador,
  locks, prevenção de duplicidade, idempotência, RLS e privilégios.
- Aplicar `scripts/sql/fix_anonymized_payment_reconciliation_20261105.sql`
  seletivamente; o script valida a definição existente e falha se houver
  deriva de código. Não executar `supabase db push`, `migration repair`
  nem replay da cadeia histórica produtiva.

## Validação

Confirmar os dois vínculos, a inexistência de duplicação na baixa e
`reconciliation_failure_count = 0`, seguido de
`private.run_payment_financial_health_check(false)` para checar
`healthy` sem e-mail de aviso. Verificar os testes de contrato em
`tests/payment_anonymized_reconciliation_contract.test.js`.

## SEO

Nenhum efeito: não há alterações em páginas, URLs, metadados, sitemap,
robots ou conteúdo indexável.
