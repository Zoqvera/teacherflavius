# ETAPA 7.3 — Auditoria de entregabilidade Resend

Data da auditoria inicial: **15/10/2026**. Escopo: e-mails transacionais
de matrícula, reposição e cancelamento de aula regular.
Referências: [issue #696](https://github.com/Zoqvera/teacherflavius/issues/696)
e [runbook de monitoramento](monitoramento-notificacoes-etapa7.md).

**Estado: auditoria interna concluída; reconciliação externa NÃO VERIFICADA.**
O código deste documento não instala webhooks nem concede acesso a chaves;
as verificações foram feitas com consultas somente leitura à produção.

## 1. Linha de base observada

A inspeção agregada das três filas no Supabase de produção encontrou:

| Fila | Registros `sent` | `pending` | `failed` | Mais de uma tentativa | `sent` sem data |
| --- | ---: | ---: | ---: | ---: | ---: |
| Matrícula | 120 | 0 | 0 | 0 | 0 |
| Reposição (confirmação) | 73 | 0 | 0 | 0 | 0 |
| Reposição (cancelamento) | 13 | 0 | 0 | 0 | 0 |
| Cancelamento de aula regular | 0 | 0 | 0 | 0 | 0 |

As 120 notificações de matrícula foram criadas entre 21/07 e 15/10/2026.
O histórico de 86 notificações de reposição vai de 21/07 a 08/10/2026.
O monitor global registrou execuções recentes `healthy` com
`metrics.email_notifications` presente e nenhuma ocorrência;
o cron de reenvio estava ativo.

**Limite crucial:** `sent` significa que o fluxo local registrou aceitação
da requisição HTTP pelo Resend, não comprova `email.delivered`.
Cada operação de matrícula envia atualmente **duas mensagens** (aluno e
professor) sob chaves de idempotência diferentes; portanto, 120 linhas
de matrícula não representam necessariamente 120 mensagens do provedor.
Não converter filas em taxas de entrega sem conciliação por mensagem.

## 2. Diagnóstico de rastreabilidade

As três Edge Functions de envio verificam a resposta HTTP de
`POST https://api.resend.com/emails`, mas **não persistem o `id`**
retornado pelo Resend:

- `notify-new-enrollment`: dois envios por notificação; um estado
  agregado de aceitação, sem duas identidades de mensagem armazenadas.
- `notify-makeup-booking`: um envio por registro, sem ID externo.
- `notify-regular-lesson-cancellation`: um envio por registro, sem ID externo.

Não existe, nas tabelas dessas filas, campo de evento entregue, bounce,
complaint ou ID de mensagem do provedor. Não foi identificado armazenamento
correspondente de eventos Resend nas tabelas de notificações. É possível
que o painel Resend exiba mensagens e eventos históricos dentro da janela
de retenção do plano, **mas ainda não foram consultados a partir deste
ambiente**. A auditoria NÃO afirma que houve ou não entrega externa.

O Resend oferece `GET /emails` com `last_event`, métricas agregadas e
webhooks para `email.delivered`, `email.bounced`,
`email.delivery_delayed`, `email.complained`,
`email.failed` e `email.suppressed`.
Um evento posterior como `opened` ou `clicked` não deve sobrescrever
o histórico de entrega/erro. Eventos atuais do provedor incluem resultado
por destinatário e devem ser tratados de forma individual.
Fontes oficiais:

- <https://resend.com/changelog/list-sent-emails-endpoint>
- <https://resend.com/changelog/email-metrics-api>
- <https://resend.com/changelog/webhook-event-visibility>
- <https://resend.com/changelog/headless-webhook-api>
- <https://resend.com/docs/dashboard/webhooks/introduction>

## 3. Consultas reprodutíveis, exclusivamente leitura

Consulta granular agregada, sem endereços, nomes nem identificadores de alunos:

```sql
with notifications as (
  select 'matricula'::text as category, status, attempts, created_at, sent_at
  from public.enrollment_email_notifications
  union all
  select case notification_type
           when 'booking_confirmation' then 'reposicao_confirmacao'
           when 'cancellation' then 'reposicao_cancelamento'
           else 'reposicao_outro'
         end,
         status, attempts, created_at, sent_at
  from public.makeup_class_email_notifications
  union all
  select 'cancelamento_regular', status, attempts, created_at, sent_at
  from public.regular_lesson_cancellation_email_notifications
)
select category, status, count(*) as total,
       count(*) filter (where attempts > 1) as retried,
       count(*) filter (where status = 'sent' and sent_at is null)
         as sent_without_timestamp,
       min(created_at) as earliest_created,
       max(created_at) as latest_created
from notifications
group by category, status
order by category, status;
```

Conferir a execução do monitor em vez de provocar uma execução adicional:

```sql
select started_at, status,
       metrics ? 'email_notifications' as includes_email_metrics,
       jsonb_array_length(coalesce(issues, '[]'::jsonb)) as issues
from private.system_health_runs
order by started_at desc
limit 5;
```

Não consultar o texto do e-mail, `last_error`, dados de autenticação,
Vault, chaves ou destinatários para gerar relatórios agregados.

## 4. Procedimento de verificação no Resend

**Sem integração de conta disponível nesta sessão**, a prova de entrega
precisa ser obtida de um painel Resend autorizado ou de uma integração
de leitura expressamente aprovada.

1. Usar `teacherflavius.com` como domínio do remetente e intervalos
   com datas explícitas; separar `matriculas@`, `contato@` e
   `financeiro@` para não confundir fluxos.
2. Para a mesma janela, obter totais de `sent`, `delivered`,
   `bounced`, `complained`, `failed`, `suppressed` e
   `delivery_delayed` e a data de observação.
3. Comparar por **mensagem**, não por linha da fila local. A matrícula
   exige separação aluno/professor. Mensagens financeiras ou avisos
   de saúde do sistema não entram no denominador transacional.
4. Registrar divergências apenas em agregados, por categoria e
   intervalo. Usar ID externo somente em trilha interna restrita.
5. Não divulgar endereços, assuntos personalizados, conteúdo ou
   identificadores pessoais em issues, testes, logs e relatórios.
6. Classificar como `nao_verificado` qualquer resultado cuja evidência
   externa não esteja disponível; jamais inferir `delivered` de `sent`.
7. A janela de retenção Resend pode limitar a auditoria retroativa.
   Documentar explicitamente a cobertura temporal efetivamente obtida.

As permissões Resend de API publicamente documentadas incluem
`full_access` e `sending_access`; **não presumir existência de uma
chave somente leitura**. Não criar, compartilhar, armazenar ou expor
uma chave `full_access` como atalho para esta auditoria.
Fonte: <https://resend.com/changelog/new-api-key-permissions>.

## 5. Arquitetura proposta — NÃO ATIVADA

Para conciliação automática futura, implementar **somente após revisão e
homologação isolada**:

1. Persistir, em esquema restrito, uma linha **por mensagem efetiva**
   com `provider_email_id`, categoria, ID da notificação, tipo de
   destinatário (aluno/professor), momento de aceitação e chave de
   idempotência ou referência interna estável. Para matrículas,
   armazenar as duas referências separadamente; preservar aceitação
   parcial sem duplicar envios no retry.
2. Receber eventos Resend num endpoint dedicado de Edge Function;
   validar assinatura Svix sobre o **corpo bruto**, timestamp e ID,
   usando segredo de assinatura exclusivo `RESEND_WEBHOOK_SIGNING_SECRET`
   configurado como Secret de Edge Function.
3. Rejeitar payload sem assinatura válida, tamanho acima do limite,
   formato não reconhecido, evento de mensagem não vinculada ou
   timestamp inválido. Deduplicar por identificador do evento; tratar
   entregas fora de ordem e replays sem retroceder estado.
4. Guardar somente a informação necessária para auditoria (ID da
   mensagem, evento, horário e categoria), sem texto, e-mail,
   assunto nem IP. Restringir tabelas e RPC a `service_role`;
   evitar `security definer` em schema exposto. Definir e aprovar
   retenção e eliminação de evidências segundo LGPD.
5. Criar métricas agregadas de aceitação, entrega confirmada,
   falha, bounce, complaint, atraso, ausência de confirmação e
   eventos desconhecidos. Não marcar como 'não entregue' uma
   mensagem apenas por não existir webhook dentro de poucos minutos.
6. Auditar na branch isolada com segredos próprios, eventos
   autênticos assinados, duplicação, replay e entrega fora de ordem.
   Depois de CI e aprovação, fazer deploy controlado e configurar
   webhook no painel Resend. Antes disso, manter os fluxos atuais
   sem alterações de comportamento.

**Dependências que exigem decisão/aprovação explícita:**
persistência por mensagem, base legal/finalidade/retenção dos metadados,
provisionamento do segredo de assinatura, habilitação do webhook no Resend
e plano de implantação. Nenhum desses passos ocorreu nesta auditoria.

## 6. Critérios de aceite da Etapa 7.3

- [x] Verificação do estado real das filas e do monitor em produção.
- [x] Revisão do fluxo HTTP dos três emissores e identificação da
      ausência de `provider_email_id`.
- [x] Fontes oficiais de eventos e permissões Resend identificadas.
- [x] Plano seguro e reproduzível de auditoria documentado.
- [ ] Obter evidências de eventos Resend para intervalo e domínio
      determinados, sem expor destinatários.
- [ ] Comparar eventos por mensagem com a fila local e registrar
      explicitamente cobertura/limites históricos.
- [ ] Decidir sobre telemetria permanente, retenção e autorização
      para configuração de webhook; se aprovado, implementar e
      homologar separadamente.

**Condição de passagem:** não encerrar a Etapa 7.3 nem iniciar
7.4 (reconciliação histórica, remetentes e idempotência) como
concluída sem prova externa ou ressalva formal de impossibilidade
de obtê-la. Não alterar Google Agenda, matrículas, créditos,
mensalidades ou envios existentes.

**SEO:** nenhuma página pública, rota indexável, metadado,
`robots.txt` ou sitemap é alterado por este documento.
