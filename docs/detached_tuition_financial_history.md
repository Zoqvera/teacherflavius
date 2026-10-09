# Mensalidades históricas sem vínculo de perfil

Quando um perfil é excluído definitivamente, a FK `monthly_tuition.student_id` utiliza `ON DELETE SET NULL` e `subject_ref` preserva a referência histórica pseudonimizada. Essa situação é intencional e não indica inconsistência, desde que a identidade histórica não esteja ausente ou incorreta.

## Relatórios e cobrança

- `get_teacher_monthly_tuition` mantém apenas cobranças de perfis ativos para pagamentos, inadimplência e previsão de recebimento.
- `get_teacher_detached_tuition_history()` oferece consulta somente leitura dos registros com `student_id IS NULL` e `subject_ref` preservado.
- O painel Controle de Mensalidades exibe esse histórico em seção e exportação separadas. Não disponibiliza registrar pagamento, isentar, estornar ou cobrar esses registros.
- `no_payment` significa apenas "sem pagamento registrado", e não comprova exigibilidade de dívida.
- Os valores da seção histórica não podem ser somados aos indicadores operacionais de recebimento ou inadimplência.

## Auditoria

Classificar `student_id IS NULL AND subject_ref IS NOT NULL` como **informativo** ("mensalidade histórica preservada"), não como falha de integridade.

Reportar como possíveis anomalias: falta de `subject_ref`; divergência entre `subject_ref` e `student_id` quando o perfil ainda está vinculado; ou duas parcelas com o mesmo `subject_ref` e `reference_month` após análise das circunstâncias. Nunca sinalizar duplicidade apenas por coincidência da competência.

Consultas read-only:

```sql
select
  count(*) filter (where student_id is null and subject_ref is not null)
    as detached_history_informational,
  count(*) filter (where subject_ref is null)
    as missing_historical_identity,
  count(*) filter (where student_id is not null and student_id <> subject_ref)
    as linked_identity_mismatch
from public.monthly_tuition;

select subject_ref, reference_month, count(*)
from public.monthly_tuition
group by subject_ref, reference_month
having count(*) > 1;
```

## Segurança e privacidade

O RPC exige a autorização administrativa usada pelo Controle de Mensalidades; `PUBLIC` e `anon` não possuem `EXECUTE`. Não retorna nome, e-mail, telefone ou notas livres. A interface exibe somente prefixo da referência pseudônima; o Excel administrativo preserva a UUID para conciliação. Não tentar vincular automaticamente os registros a outros alunos.

## Critérios de aceite

- Os cinco registros atualmente preservados continuam sem mudanças e são retornados no relatório histórico.
- A área de mensalidades de alunos ativos permanece inalterada.
- O histórico separado mostra duas parcelas isentas e três sem pagamento registrado, sem declarar dívida exigível.
- O histórico exige autenticação e autorização administrativa.
- O relatório de auditoria diferencia referências históricas preservadas de integridade comprometida.

**SEO:** nenhum metadado, URL, conteúdo público indexável ou redirecionamento é alterado.
