# ETAPA 7 — Monitoramento assistido das notificações

Referências: [issue #696](https://github.com/Zoqvera/teacherflavius/issues/696),
[homologação #680](https://github.com/Zoqvera/teacherflavius/issues/680).

## Objetivo e limites

Este procedimento audita, sem qualquer escrita, os e-mails transacionais de
matrícula, reposição e cancelamento regular, além do job
`transactional-email-retry-10m`. Ele não cria agendamentos nem alertas por si
só. A automação de alertas requer mecanismo agendado habilitado e testado
separadamente.

- Usar exclusivamente `SELECT`; não invocar a função de reenvio, nem
  modificar registros, cron, alunos, segredos ou agendas.
- Consultar apenas totais agregados, sem nome, e-mail, ID pessoal ou conteúdo
  das mensagens.
- `sent` significa registro aceito pelo fluxo da aplicação: **não prova
  entrega**. Para rejeição, bounce ou entrega, exigir evidência verificável
  do Resend; não inferir pelo banco.
- Não simular indisponibilidade real do Resend na produção. Qualquer ensaio
  externo pertence a um ambiente isolado, com risco/custo aprovados.

## Consulta 1 — Saúde das três filas

A consulta lista inclusive a fila vazia de cancelamento e tem limiares
explícitos para atraso, expiração e tentativas esgotadas.

```sql
with queue_names(queue_name) as (
  values ('matricula'), ('reposicao'), ('cancelamento_regular')
),
notifications as (
  select 'matricula' as queue_name, status, attempts, created_at, sent_at
  from public.enrollment_email_notifications

  union all

  select 'reposicao', status, attempts, created_at, sent_at
  from public.makeup_class_email_notifications

  union all

  select 'cancelamento_regular', status, attempts, created_at, sent_at
  from public.regular_lesson_cancellation_email_notifications
)
select current_timestamp as checked_at,
       q.queue_name,
       count(n.status) as records,
       count(*) filter (where n.status = 'sent') as sent_count,
       count(*) filter (where n.status = 'pending') as pending_count,
       count(*) filter (where n.status = 'failed') as failed_count,
       count(*) filter (
         where n.status in ('pending', 'failed')
           and n.created_at < current_timestamp - interval '20 minutes'
       ) as delayed_20min,
       count(*) filter (
         where n.status in ('pending', 'failed')
           and n.created_at < current_timestamp - interval '18 hours'
       ) as aged_18h,
       count(*) filter (
         where n.status in ('pending', 'failed') and n.attempts >= 3
       ) as exhausted_attempts,
       count(*) filter (
         where n.status = 'sent' and n.sent_at is null
       ) as sent_missing_timestamp
from queue_names q
left join notifications n using (queue_name)
group by q.queue_name
order by q.queue_name;
```

## Consulta 2 — Saúde do cron

Retorna também uma linha quando o job foi removido: nesse caso `jobid` é
`NULL`. O histórico do `cron.job_run_details` pode ser parcial ou sofrer
limpeza. Portanto `successful_runs` não implica cobertura contínua das 24h.

```sql
with target(job_name) as (
  values ('transactional-email-retry-10m')
)
select current_timestamp as checked_at,
       t.job_name,
       j.jobid,
       j.active,
       j.schedule,
       recent.successful_runs,
       recent.unsuccessful_runs,
       recent.first_recorded_run,
       recent.latest_success,
       round(
         extract(epoch from (current_timestamp - recent.latest_success)) / 60,
         2
       ) as minutes_since_success
from target t
left join cron.job j on j.jobname = t.job_name
left join lateral (
  select count(*) filter (
           where status = 'succeeded'
             and start_time >= current_timestamp - interval '24 hours'
         ) as successful_runs,
         count(*) filter (
           where status <> 'succeeded'
             and start_time >= current_timestamp - interval '24 hours'
         ) as unsuccessful_runs,
         min(start_time) as first_recorded_run,
         max(end_time) filter (where status = 'succeeded') as latest_success
  from cron.job_run_details r
  where r.jobid = j.jobid
) recent on true;
```

## Escalonamento

1. **Crítico:** job ausente/inativo, programação diferente de
   `*/10 * * * *`, ou `latest_success` inexistente/mais antigo que 20
   minutos. Verificar execução e registros antes de qualquer intervenção.
2. **Alto:** `delayed_20min > 0`, `aged_18h > 0` ou
   `exhausted_attempts > 0`. Investigar falha e elegibilidade, respeitando
   a janela de reenvio e a idempotência; não forçar disparos.
3. **Médio:** `sent_missing_timestamp > 0`, ou execução malsucedida
   recente. Correlacionar com logs sem revelar dados pessoais.
4. **Informativo:** `pending`/`failed` recentes, sem atraso, ou
   divergências entre contagens históricas. Observar, sem inferir perda
   de e-mails ou recuperação espontânea.

Uma auditoria não realizada por indisponibilidade do acesso é
**não verificável**, nunca equivale a `saudável`. Registros de cron não
substituem provas do provedor externo. A ausência de falhas não
garante recebimento de todas as mensagens.

## Linha de base observada

**15/10/2026, 13h17–13h18 UTC** — consultas somente leitura na produção:

| Fila | `sent` | `pending` | `failed` | Atrasadas >20 min | Sem `sent_at` |
| --- | ---: | ---: | ---: | ---: | ---: |
| Matrícula | 119 | 0 | 0 | 0 | 0 |
| Reposição | 86 | 0 | 0 | 0 | 0 |
| Cancelamento regular | 0 | 0 | 0 | 0 | 0 |

O job 12 estava ativo, programação `*/10 * * * *`. Histórico
disponível: 54 execuções, todas bem-sucedidas, da primeira às
04h20 UTC até a última às 13h10 UTC, em 15/10/2026. A janela
efetivamente observada é menor que 24 horas, embora a consulta
esteja filtrada para as últimas 24 horas.

**Divergência pendente de apuração:** auditorias históricas na
[issue #680](https://github.com/Zoqvera/teacherflavius/issues/680)
registraram 120 notificações de matrícula em `sent`; a consulta
atual conta 119. Não há, nesta leitura agregada, evidência suficiente
para atribuir a diferença a exclusão, retificação ou incidente.
Investigar antes de concluir; não alterar dados produtivos.

## Critérios para encerramento operacional

- Filas sem atrasos persistentes, tentativas esgotadas ou inconsistências
  `sent_at`, ao longo de uma janela de acompanhamento documentada.
- Cron ativo e executando conforme programação, sem hiatos acima de 20
  minutos nas observações disponíveis.
- Algum mecanismo recorrente de observação/alerta autorizado e efetivamente
  ativo, **ou** registro explícito de que o acompanhamento permanecerá manual.
- Limite de verificação do Resend explicitamente reconhecido.
- Orientação de calendário preservada: INDIVIDUAL oferece proposta manual
  de evento ao professor; QUINTETO não cria nem sugere evento ao professor.

**Estado em 15/10/2026:** auditoria pontual satisfatória; monitoramento
recorrente adicional **não ativado** porque o limite vigente de tarefas
agendadas foi atingido. Não desativar automações existentes sem decisão do
responsável. A Etapa 7 permanece aberta para acompanhamento.

**SEO:** nenhuma alteração em páginas indexáveis, rotas, metadados,
sitemap ou robots.txt.


## Integração nativa à saúde do sistema — Etapa 7.2

A migração versionada
`supabase/migrations/20261015134000_integrate_email_notifications_with_system_health.sql`
insere a análise agregada no monitor existente de 5 minutos. Não depende de
vaga para tarefas do ChatGPT, não adiciona cron e não faz envios de testes.

O resultado, após a migração ser publicada no banco, integra o bloco
`metrics.email_notifications`, os `issues` da última execução e os
alertas administrativos deduplicados. Os códigos de alerta estão documentados
em `docs/system_health_monitoring.md`.

O serviço de monitoramento depende da saúde do próprio monitor global e da
fila de alertas existente. Um alerta que falha no Resend não equivale a uma
notificação recebida pelo professor. O passo seguinte é verificar a aplicação
efetiva da migração, confirmar uma execução real do health check e observar
os resultados antes de declarar a Etapa 7.2 concluída.

**Plano de reversão:** em caso de regressão, desabilitar os dois triggers
`attach_email_health_to_system_run` e
`enqueue_email_health_alerts_from_system_run`, restaurar a antiga RPC
`public.run_system_health_check_internal(boolean)` preservada no histórico
versionado e verificar a saúde do monitor; executar a reversão apenas por
migração de correção testada e revisada. Não alterar filas ou cron de envio.
