# Analytics server-side de pagamentos

Data de referência: 12 de setembro de 2026.

## Objetivo

Registrar conversões financeiras no GA4 a partir do estado autoritativo do backend, reduzindo a dependência de o navegador permanecer aberto até a confirmação do pagamento.

A implantação é deliberadamente dividida em duas fases para evitar perda ou duplicação de métricas durante a transição.

## Fase A — captura e outbox sem alterar a fonte atual de `purchase`

Nesta fase:

- o navegador continua emitindo o evento `purchase` existente após `refreshAfterPayment()` confirmar a baixa;
- somente usuários que concederam consentimento analítico têm contexto capturado para o backend;
- o navegador obtém `client_id` e `session_id` do GA4 via `gtag('get', ...)`;
- antes da criação do pagamento, uma Edge Function autenticada registra um preflight associado à mesma `idempotency_key` usada na cobrança;
- a captura é best-effort e nunca bloqueia nem invalida o pagamento;
- o settlement autoritativo no banco cria um item de outbox somente quando existe contexto analítico consentido;
- uma rotina de backfill cobre a corrida em que o settlement ocorre antes de a captura conseguir ligar o contexto à tentativa;
- `purchase` e `refund` são deduplicados por `(event_name, provider_payment_id)`.

O dispatcher GA4 pode permanecer implantado mas sem `GA4_API_SECRET`. Nesse estado ele responde configuração incompleta antes de reivindicar qualquer item da outbox. Nenhum cron de envio deve ser criado enquanto o segredo não estiver configurado e validado.

## Consentimento e privacidade

O módulo `analytics_payments.js` só é carregado pela infraestrutura de analytics depois que `TeacherFlaviusPrivacy.hasAnalyticsConsent()` permite analytics. A Edge Function exige ainda `analytics_consent: true` no pedido.

A captura server-side armazena somente:

- `client_id` do GA4;
- `session_id` quando disponível;
- identificadores técnicos da tentativa e mensalidade;
- valor, modalidade e ID técnico do pagamento para o evento final.

Não são armazenados no outbox:

- nome;
- e-mail;
- CPF;
- WhatsApp;
- número de cartão;
- CVV;
- token do cartão;
- Access Token do Mercado Pago.

## Isolamento financeiro

Analytics não participa da decisão de cobrança ou baixa.

Falha ao obter IDs do GA4, falha da Edge Function de captura, ausência de consentimento, GA4 indisponível ou segredo ausente não podem impedir:

- criação do pagamento;
- Webhook;
- reconciliação;
- baixa;
- refund;
- chargeback.

A fonte financeira continua sendo Mercado Pago + settlement autoritativo no banco.

## Componentes

### Tabelas

`payment_analytics_preflight`
: contexto consentido temporário antes de a tentativa existir. Expira em dois dias.

`payment_analytics_context`
: contexto associado à tentativa financeira real.

`payment_analytics_outbox`
: fila deduplicada de `purchase` e `refund`, com estados `pending`, `processing`, `sent` e `failed`.

As três tabelas têm RLS habilitado, acesso revogado de `public`, `anon` e `authenticated` e operações internas reservadas ao `service_role`.

### Edge Functions

`capture-payment-analytics-context`
: exige JWT, valida que a mensalidade pertence ao usuário autenticado e grava contexto somente com consentimento explícito.

`dispatch-payment-analytics`
: usa autenticação interna por timestamp + HMAC já adotada na reconciliação automática. `verify_jwt=false` é intencional porque não há chamada de navegador. A função exige `GA4_API_SECRET` antes de reivindicar itens da fila.

### Banco

`private.enqueue_payment_analytics_event_id(...)`
: deriva eventos somente de `monthly_tuition_events` produzidos pelo settlement Mercado Pago.

`claim_payment_analytics_outbox(...)`
: reivindica lotes com `FOR UPDATE SKIP LOCKED` e recupera itens presos em `processing`.

`finish_payment_analytics_outbox(...)`
: registra sucesso ou falha e aplica backoff progressivo.

`backfill_payment_analytics_outbox(...)`
: fecha a corrida entre captura de contexto e settlement sem duplicar evento.

## Configuração do GA4

A configuração exige um Measurement Protocol API secret. O valor é segredo e nunca deve ser enviado no chat, commitado ou colocado no frontend.

Measurement ID atual:

```text
G-11V3W5B6TG
```

Secret esperado no Supabase:

```text
GA4_API_SECRET
```

`GA4_MEASUREMENT_ID` é opcional porque a função possui o Measurement ID público atual como default. Se for usado, deve conter o mesmo ID do stream Web.

Depois de cadastrar o segredo, validar uma chamada controlada do dispatcher sem itens ou com evidência de teste isolada antes de criar o cron.

## Fase B — ativação autoritativa server-side

Somente depois de confirmar que o Measurement Protocol recebe corretamente os eventos:

1. criar dispatcher assinado periódico para `dispatch-payment-analytics`;
2. confirmar `pending -> sent` em item controlado ou no primeiro evento legítimo consentido;
3. confirmar `transaction_id = provider_payment_id`;
4. verificar o evento no GA4 DebugView/Realtime quando aplicável;
5. desativar a emissão client-side de `purchase` para impedir duas fontes concorrentes;
6. manter `begin_checkout`, `add_payment_info` e `payment_error` no navegador;
7. monitorar itens `failed`/stale da outbox.

Até esses critérios serem satisfeitos, a emissão client-side de `purchase` permanece ativa.

## Retry e deduplicação

A outbox usa uma chave única composta por nome do evento e `provider_payment_id`. Reprocessamentos do Webhook, reconciliação repetida e reentrada no backfill não criam outro item para o mesmo `purchase` ou `refund`.

O claim usa lock e `SKIP LOCKED`, permitindo concorrência segura. Falhas de entrega recebem backoff; itens presos em `processing` por mais de 10 minutos voltam a ser elegíveis.

## Critérios para considerar a migração concluída

A dependência do navegador só pode ser removida quando:

- `GA4_API_SECRET` estiver configurado no Supabase;
- dispatcher tiver autenticação HMAC validada;
- Measurement Protocol responder com sucesso;
- um evento `purchase` consentido passar por `pending -> sent`;
- não houver duplicidade de `transaction_id` atribuível à transição;
- health financeiro permanecer `healthy`;
- o cliente continuar sem acesso às tabelas/RPCs internas de analytics financeiro.
