# Escalada de falhas consecutivas na reconciliação do Mercado Pago

Data de referência: 11 de setembro de 2026.

## Objetivo

Evitar que uma tentativa de pagamento com falhas transitórias repetidas permaneça indefinidamente apenas em retry silencioso. A reconciliação automática continua tentando recuperar o estado no Mercado Pago, mas falhas consecutivas passam por dois níveis operacionais de alerta.

## Regra de escalada

A contagem usada é `tuition_payment_attempts.reconciliation_failure_count`.

- primeira falha consecutiva (`0 -> 1`): alerta `reconciliation_failure` com severidade `warning`;
- segunda falha (`1 -> 2`): nenhum novo alerta, evitando ruído;
- terceira falha (`2 -> 3`): novo alerta `reconciliation_failure` com severidade `critical` e chave de deduplicação própria;
- quarta falha em diante: o retry continua, mas o alerta crítico não é duplicado.

A chave do primeiro alerta é `reconciliation_failure:<attempt_id>`. A escalada usa `reconciliation_failure_escalated:<attempt_id>`.

Com a reconciliação agendada a cada cinco minutos, três falhas consecutivas representam aproximadamente 10 a 15 minutos de indisponibilidade ou erro persistente, dependendo do momento da primeira tentativa.

## Por que o retry não é interrompido

Falhas de rede, timeout, HTTP 429 ou 5xx podem ser temporárias. Interromper automaticamente a reconciliação depois de um número fixo de tentativas aumentaria o risco de manter um pagamento aprovado sem sincronização. Por isso, a terceira falha muda a prioridade operacional para `critical`, mas não desabilita novas tentativas.

Quando uma reconciliação posterior é bem-sucedida, `process_mercado_pago_payment` continua zerando `reconciliation_failure_count` e limpando `last_reconciliation_error`, preservando a convergência automática já validada nos cenários sandbox.

## Segurança

A função auxiliar de classificação está no schema `private` e teve `EXECUTE` revogado de `public`, `anon`, `authenticated` e `service_role`. Ela é usada internamente pela trigger `private.capture_payment_attempt_alert`, que já controla os alertas de reconciliação e gateway.

Nenhum acesso novo à Data API foi criado. A alteração não modifica credenciais, Webhooks, valores de mensalidades nem regras de baixa financeira.

## Validação

A função de classificação foi verificada diretamente no Supabase com os seguintes resultados:

- `0 -> 1`: `warning`;
- `1 -> 2`: sem novo alerta;
- `2 -> 3`: `critical`;
- `3 -> 4`: sem alerta duplicado.

Também foi confirmado que `anon`, `authenticated` e `service_role` não possuem permissão de execução direta na função auxiliar.

Os contratos automatizados verificam o limiar de três falhas, a chave de deduplicação distinta, a continuidade do retry e a preservação da captura existente de falhas do gateway.

## SEO

Sem impacto. Esta alteração afeta exclusivamente lógica operacional de pagamentos, migration, documentação interna e testes; não altera páginas públicas, URLs, metadata, sitemap, robots ou conteúdo indexável.
