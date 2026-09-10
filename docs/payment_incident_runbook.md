# Runbook de incidentes financeiros

## 1. Finalidade

Este runbook define como diagnosticar, conter, recuperar e encerrar incidentes do fluxo de mensalidades integrado ao Mercado Pago. O objetivo principal é preservar três invariantes:

1. nenhum pagamento deve ser aplicado mais de uma vez;
2. o estado financeiro local deve convergir para o estado atual do Mercado Pago;
3. nenhuma ação corretiva deve criar um segundo efeito financeiro enquanto o primeiro ainda não foi confirmado.

O procedimento é **UI-first**: a primeira fonte operacional é o Controle de Mensalidades em `/mensalidades/`, incluindo o painel “Saúde técnica dos pagamentos”, o histórico de webhooks, refunds e chargebacks. SQL deve ser usado apenas para auditoria técnica quando a interface não oferece detalhe suficiente.

## 2. Classificação de severidade

### P0 — integridade financeira ou segurança

Use P0 quando houver evidência de um ou mais destes casos:

- pagamento aprovado aplicado à mensalidade errada;
- mais de um pagamento aprovado aplicado como uma única baixa sem tratamento de duplicidade;
- refund executado sem intenção administrativa;
- reversão/chargeback sem reversão local correspondente;
- credencial ou dado financeiro sensível exposto;
- alteração em massa de estado financeiro sem causa conhecida.

Ação: interromper correções manuais, preservar evidências e investigar antes de qualquer nova mutação financeira.

### P1 — indisponibilidade ou perda de convergência

Use P1 quando:

- `financial_health.status = critical`;
- reconciliação automática ficar sem sucesso por mais de 15 minutos;
- pagamentos aprovados permanecerem sem baixa;
- webhooks ficarem travados em `processing` por mais de 2 minutos;
- gateway ficar indisponível de forma recorrente;
- fila de alertas financeiros ficar em `failed`;
- prazo de documentação de chargeback estiver vencido ou abaixo de 24 horas sem submissão.

Ação: restaurar convergência e disponibilidade, sem repetir efeitos já aceitos pelo provedor.

### P2 — caso isolado com operação geral saudável

Use P2 para um pagamento, refund, webhook ou chargeback isolado quando o health check geral permanece saudável ou apenas degradado e não há risco de propagação.

## 3. Triagem inicial

Sempre faça nesta ordem:

1. Abra `/mensalidades/` e leia o estado do **health check financeiro automático**.
2. Confirme o horário da última execução. Um estado antigo deve ser tratado como `ATRASADO`, mesmo que o último resultado registrado tenha sido `healthy`.
3. Verifique divergências, falhas do gateway, reconciliação, alertas abertos, webhooks, refunds e chargebacks.
4. Determine se o incidente é P0, P1 ou P2.
5. Registre o horário, os códigos de incidente exibidos e os identificadores técnicos necessários. Não copie CPF, cartão, token, chave privada ou assinatura para tickets/notas.
6. Antes de reprocessar algo, confirme se a operação pode ter sido aceita pelo Mercado Pago mesmo que a resposta local tenha falhado.

## 4. Pagamento pendente por tempo excessivo

### Sintoma

Um pagamento permanece `created`, `pending`, `authorized`, `in_process` ou `in_mediation` por tempo incompatível com o fluxo esperado.

### Diagnóstico

- confirme se existe `provider_payment_id`;
- consulte a última reconciliação no dashboard;
- confirme se a reconciliação automática está `EM DIA`;
- verifique falhas de gateway nas últimas 24 horas.

### Recuperação

- para aluno: a reconciliação manual só pode consultar tentativas do próprio `student_id`;
- para professor: a reconciliação ampla exige sessão administrativa MFA/AAL2;
- a reconciliação deve consultar **o estado atual no Mercado Pago** e então aplicar o resultado localmente;
- não crie uma nova cobrança enquanto existir uma tentativa ativa cujo estado ainda não foi esclarecido.

### Critério de encerramento

O estado local coincide com o provedor e o health check não aponta tentativa pendente antiga ou divergência associada.

## 5. Pagamento aprovado sem baixa

### Sintoma

`approved_without_application > 0` ou alerta `approved_without_application`.

### Contenção

Não marque a mensalidade manualmente como paga antes de confirmar a tentativa aprovada. Isso evita dupla baixa ou associação ao pagamento errado.

### Recuperação

1. identifique a tentativa e o `provider_payment_id` no contexto técnico;
2. execute/reaguarde a reconciliação;
3. a rotina `process_mercado_pago_payment` deve aplicar a baixa de forma atômica;
4. confirme `applied_at` preenchido e divergência zerada.

### Escalonamento

Se o Mercado Pago confirmar `approved` e a baixa continuar ausente após reconciliação, classifique como P1; se houver aplicação em mensalidade incorreta, P0.

## 6. Pagamento duplicado

### Sintoma

Alerta `duplicate_payment` ou mais de uma tentativa aprovada para a mesma mensalidade.

### Contenção

- não apague tentativas;
- não altere manualmente o `provider_payment_id`;
- não execute refund antes de identificar qual pagamento é excedente;
- preserve ambos os IDs do provedor como evidência técnica.

### Recuperação

1. confirme no Mercado Pago que existem dois efeitos financeiros distintos;
2. identifique qual pagamento já foi aplicado à mensalidade;
3. use o fluxo administrativo de refund somente para o pagamento excedente confirmado;
4. acompanhe o refund até `synchronized`;
5. confirme que a mensalidade mantém exatamente uma baixa válida.

## 7. Webhook ausente, duplicado ou falhado

### Sintoma

- pagamento existe no Mercado Pago, mas não houve atualização local;
- `payment_webhook_events.status = failed`;
- entrega duplicada (`delivery_count > 1`);
- processamento travado por mais de 2 minutos.

### Princípios

- uma entrega duplicada não é, por si só, incidente: o log é deduplicado e o processamento financeiro é idempotente;
- o replay nunca deve reutilizar um payload financeiro antigo como fonte de verdade;
- o replay deve reconsultar o pagamento atual no Mercado Pago.

### Recuperação

Use o botão **REPROCESSAR** no log de webhooks quando o evento for de pagamento e possuir `provider_payment_id`. O fluxo `replay-mercado-pago-webhook` reconsulta o provedor e reutiliza o processamento atômico compartilhado.

Não reprocessar repetidamente um evento que continua em `processing` recente. O sistema permite reclaim apenas depois da janela de stale processing.

## 8. Assinatura de webhook inválida

### Sintoma

Aumento de `invalid_webhooks_24h` ou alerta `invalid_webhook_burst`.

### Diagnóstico

- diferencie uma assinatura inválida isolada de uma rajada;
- valide que o webhook oficial do Mercado Pago continua entregando eventos válidos;
- não registre nem copie a assinatura recebida para documentação do incidente.

### Resposta

Se eventos válidos continuam chegando e não há impacto financeiro, trate como P2/segurança observacional. Se os eventos legítimos também falharem e a convergência passar a depender apenas de reconciliação, trate como P1.

## 9. Reconciliação automática atrasada ou falhando

### Sintoma

- `reconciliation_stalled = true`;
- alerta `reconciliation_stalled`;
- health code `reconciliation_cron_unhealthy`;
- ausência de execução bem-sucedida por mais de 15 minutos.

### Diagnóstico

Verifique, nesta ordem:

1. cron `mercado-pago-reconciliation` ativo;
2. últimas execuções em `cron.job_run_details`;
3. disponibilidade da Edge Function `reconcile-mercado-pago-automated`;
4. falhas de gateway;
5. assinatura/timestamp do dispatch.

### Recuperação

Restaure primeiro o mecanismo de reconciliação. Não tente corrigir em massa cada tentativa individual se a causa for sistêmica. Depois de restaurado, deixe a reconciliação convergir os estados e confirme o health check.

## 10. Falha do Mercado Pago / indisponibilidade do gateway

### Sintoma

- `gateway_failures_24h > 0`;
- respostas 5xx/timeout do provedor;
- criação ou consulta de pagamentos indisponível.

### Contenção

- não gerar loops de retry no navegador;
- não criar múltiplas tentativas para a mesma mensalidade;
- preservar a chave de idempotência durante retry da mesma intenção de pagamento.

Quando a criação de PIX for recusada pela política específica já tratada pelo backend, a aplicação apresenta o fallback configurado e notifica o professor. Não publicar tokens, diagnósticos de credencial ou respostas completas do gateway ao aluno.

### Recuperação

Após normalização do provedor, execute/reaguarde reconciliação antes de iniciar nova cobrança para qualquer tentativa cujo resultado tenha ficado ambíguo.

## 11. Refund

### Antes de executar

Confirme:

- pagamento aprovado correto;
- `provider_payment_id` correto;
- valor e mensalidade correspondentes;
- inexistência de refund anterior já aceito pelo provedor.

### Falha durante refund

Se a chamada local falhar depois de contato com o Mercado Pago, trate o resultado como **ambíguo** até consultar o provedor. Não envie uma segunda solicitação de refund apenas porque a primeira resposta não chegou ao navegador.

### Encerramento

O request de refund deve chegar a `synchronized` e o estado da tentativa/mensalidade deve refletir a reversão correspondente. `failed` ou `provider_accepted` antigo exige investigação.

## 12. Chargeback

### Ao abrir uma contestação

1. confirme o `provider_chargeback_id` e o pagamento associado;
2. acompanhe `operational_status`;
3. verifique `documentation_status` e `documentation_deadline`;
4. abra/preencha o caso de documentação;
5. registre evidências sem armazenar segredos ou dados de cartão.

### Prazos

- até 72h: warning;
- até 24h: critical;
- vencido: critical/P1.

Após `submitted` ou `closed`, o scanner não deve continuar emitindo alerta de prazo para o mesmo caso.

## 13. Alertas financeiros não entregues

### Sintoma

`payment_alert_notifications.status = failed` ou `failedAlerts > 0`.

### Diagnóstico

- confirme se o evento financeiro original ainda está ativo;
- verifique disponibilidade/configuração do Resend;
- confira `attempts` e `last_error` sem copiar credenciais.

O scanner retorna alertas falhos para `pending` após a janela de retry enquanto `attempts < 5`.

### Escalonamento

Se alertas críticos não puderem ser enviados, o dashboard passa a ser a fonte obrigatória de acompanhamento até a entrega ser restaurada.

## 14. Health check financeiro `degraded`, `critical` ou `ATRASADO`

### `degraded`

Há warning operacional sem violação crítica conhecida. Investigue `issue_codes`, priorizando gateway, alertas, stale processing e reconciliação.

### `critical`

Há ao menos uma invariante crítica. Trate primeiro `approved_without_application`, `reversal_pending`, inconsistências de refund/chargeback e falhas de crons que impeçam convergência.

### `ATRASADO`

A ausência de health check recente é um incidente de observabilidade. Verifique cron `payment-financial-health-check` e o scanner independente que detecta sua parada.

### Encerramento

Não encerre apenas porque um alerta foi enviado. Exija uma execução posterior `healthy` com `issue_count = 0`.

## 15. Ordem de dependências para diagnóstico

Use esta sequência para localizar a camada defeituosa:

1. **Banco/invariantes** — health check e dashboard;
2. **Crons** — agendamento e histórico de execução;
3. **Edge Functions** — autenticação e execução;
4. **Mercado Pago** — estado atual do pagamento/refund/chargeback;
5. **Resend** — apenas para entrega de alertas;
6. **Frontend** — apresentação/ação administrativa.

Isso evita tratar um sintoma de interface como falha financeira ou repetir uma operação já aceita externamente.

## 16. Critérios globais de recuperação

Um incidente financeiro só pode ser considerado recuperado quando:

- o provedor e o banco convergiram;
- não existe baixa ou reversão pendente relacionada;
- não há operação externa ambígua;
- os crons necessários estão ativos e com execução recente bem-sucedida;
- o health check executou depois da correção e retornou `healthy`;
- alertas críticos associados não permanecem `pending`/`failed` sem explicação.

## 17. Pós-incidente

Para P0 e P1, registre no mínimo:

- início e fim do incidente;
- primeira evidência observável;
- impacto financeiro e número de cobranças afetadas;
- causa raiz;
- por que os controles existentes detectaram ou não detectaram o problema;
- ações de contenção e recuperação;
- confirmação de convergência;
- alteração preventiva proposta;
- teste/contrato acrescentado para impedir regressão.

Nunca inclua tokens, segredos Supabase, assinatura HMAC, dados completos de cartão ou CPF no pós-incidente.
