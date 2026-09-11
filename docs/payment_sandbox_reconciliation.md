# Reconciliação sandbox do Mercado Pago

Data de referência: 11 de setembro de 2026.

## Objetivo

Validar, sem tocar na base financeira de produção, o caminho de recuperação usado quando uma notificação Webhook do Mercado Pago não está disponível.

O cenário é deliberadamente isolado: um candidato de teste é criado com `provider_payment_id = NULL`, contendo apenas a `external_reference` e o valor esperado. O reconciliador sandbox deve localizar o pagamento diretamente na API do Mercado Pago, recuperar o identificador do provedor e registrar o estado observado.

## Endpoint

```text
https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/reconcile-mercado-pago-sandbox
```

O endpoint usa `verify_jwt=false` porque é chamado de forma service-to-service pelo Postgres via `pg_net`. A ausência de JWT não torna a função anônima: a própria função exige os mesmos headers assinados usados pelo reconciliador automático de produção:

- `x-reconciliation-timestamp` dentro da janela de tolerância;
- `x-reconciliation-signature` HMAC-SHA256 válida;
- validação server-side por `public.validate_mercado_pago_reconciliation_signature`.

A assinatura continua baseada no segredo `mercado_pago_reconciliation_cron_secret` armazenado no Supabase Vault. Nenhum novo segredo operacional é necessário.

## Isolamento

A função usa exclusivamente `MERCADO_PAGO_TEST_ACCESS_TOKEN` e a tabela:

`public.mercado_pago_sandbox_reconciliation_candidates`

Ela não lê nem altera:

- `monthly_tuition`;
- `tuition_payment_attempts`;
- `payment_reconciliation_runs`;
- `mercado_pago_sandbox_webhook_events`;
- qualquer baixa financeira de aluno.

A tabela sandbox possui RLS habilitado e os acessos de `public`, `anon` e `authenticated` são revogados.

## Cenário missed_webhook

O candidato começa com:

- `scenario = 'missed_webhook'`;
- `reconciliation_status = 'pending'`;
- `provider_payment_id = NULL`;
- `external_reference` iniciando por `sandbox-card-`;
- `expected_amount > 0`.

O reconciliador consulta `/v1/payments/search` usando a `external_reference`. Somente um pagamento com os mesmos dados de negócio, `live_mode = false` e valor compatível pode ser recuperado.

Se houver exatamente uma correspondência válida, o candidato passa para `recovered` e recebe `provider_payment_id`, `provider_status`, método de pagamento, timestamps e `recovered_at`.

Se nenhuma correspondência existir, o candidato permanece `pending` com `last_error_code = 'not_found'`. Múltiplos pagamentos compatíveis ou dados de produção tornam o candidato `failed`.

## Disparo manual seguro

A migration cria `private.dispatch_mercado_pago_sandbox_reconciliation()`. Essa função gera timestamp e assinatura HMAC usando o mesmo segredo do reconciliador de produção e chama a Edge Function via `pg_net`.

Ela não é agendada por `pg_cron`; o teste sandbox só é disparado explicitamente.

## Critério de aprovação

O cenário de recuperação é considerado validado quando um candidato criado sem `provider_payment_id` termina com:

- `reconciliation_status = 'recovered'`;
- `provider_payment_id` preenchido pela consulta ao Mercado Pago;
- `provider_status` correspondente ao estado no provedor;
- `live_mode = false`;
- `reconciliation_attempts >= 1`;
- `recovered_at` preenchido;
- nenhuma alteração nas tabelas financeiras de produção.

Esse teste valida o princípio operacional usado pelo reconciliador real: o Webhook acelera a convergência, mas não é a única fonte de verdade para recuperar o estado de um pagamento.
