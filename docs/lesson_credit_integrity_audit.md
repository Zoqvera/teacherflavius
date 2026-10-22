# Auditoria diária de créditos de aulas

A função `private.audit_paid_lesson_schedule_integrity()` é consultada diariamente às **23h no fuso America/Sao_Paulo**, usando a agenda `0 2 * * *` do `pg_cron` configurado em GMT.

## Comportamento

- Cada data local produz no máximo uma execução no histórico `private.lesson_credit_integrity_runs`.
- Uma auditoria sem inconsistências registra `email_status = 'not_required'` e **não envia e-mail**.
- Quando há problemas, o sistema solicita um e-mail pelo Resend, com remetente `TeacherFlavius <contato@teacherflavius.com>`, destinatário fixo `contato@teacherflavius.com` e assunto `Alerta de integridade — TeacherFlavius`.
- Os detalhes incluem aluno, código e descrição do problema, horário da aula (se houver) e ID do crédito.
- Tentativas de envio são limitadas a três dentro de uma janela de 18 horas; a varredura de reenvio ocorre a cada 15 minutos. O mesmo ID de execução é usado como chave de idempotência no Resend.
- **Nenhuma operação modifica créditos ou mensalidades**. A auditoria não corrige as ocorrências automaticamente.

## Histórico — consulta no SQL Editor

```sql
select
  audit_date,
  executed_at at time zone 'America/Sao_Paulo' as executado_em,
  issue_count as inconsistencias,
  email_status,
  attempts as tentativas,
  sent_at at time zone 'America/Sao_Paulo' as enviado_em,
  last_error
from private.lesson_credit_integrity_runs
order by audit_date desc
limit 30;
```

Os status possíveis são `not_required` (sem inconsistências), `pending` (aguardando envio), `sending` (em processamento), `sent` (aceito pelo serviço de e-mail) e `failed` (erro).

## Detalhamento de uma auditoria

```sql
select
  run.audit_date,
  issue.value ->> 'student_name' as aluno,
  issue.value ->> 'issue_code' as problema,
  issue.value ->> 'credit_id' as credito,
  issue.value ->> 'starts_at' as data_da_aula
from private.lesson_credit_integrity_runs run
cross join lateral jsonb_array_elements(run.issues) issue(value)
where run.audit_date = (now() at time zone 'America/Sao_Paulo')::date
order by aluno, problema;
```

## Operação e privacidade

A Edge Function `notify-lesson-credit-integrity` valida `x-webhook-secret` antes de usar funções RPC restritas ao `service_role`. Não é permitido acesso direto à tabela privada para `anon` ou `authenticated`.

A rotina manual `select private.run_daily_lesson_credit_integrity();` grava uma execução **definitiva para a data**; portanto, não execute antecipadamente apenas para testar, pois a execução programada não repetirá a auditoria daquele dia. Para diagnóstico sem gravar dados, execute `select * from private.audit_paid_lesson_schedule_integrity();`.

A rotina de reenvio é `select private.retry_lesson_credit_integrity_emails();`. Um relatório marcado `sent` não é reenviado.
