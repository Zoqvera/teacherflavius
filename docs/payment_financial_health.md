# Health check financeiro automático

O subsistema de pagamentos executa um health check financeiro persistente a cada cinco minutos. A rotina roda diretamente no PostgreSQL via `pg_cron`, sem depender de uma chamada HTTP ou de uma nova Edge Function.

## Estados

- `healthy`: nenhuma invariante crítica ou de atenção está violada.
- `degraded`: existe pelo menos uma condição de atenção, mas nenhuma invariante crítica foi violada.
- `critical`: existe pelo menos uma invariante financeira crítica violada ou a própria execução do health check falhou.

O histórico fica em `private.payment_financial_health_runs` por 90 dias. O schema `private` não é exposto ao Data API e `anon`/`authenticated` não possuem acesso à tabela nem à função executora.

## Invariantes críticas

A rotina verifica pagamentos aprovados sem baixa, reversões pendentes, múltiplas aprovações aplicadas à mesma mensalidade, divergência entre tentativa aplicada e mensalidade, pagamento rejeitado aplicado, inconsistências de reembolso e chargeback, duplicidade de IDs do provedor ou chaves de idempotência, webhook preso em processamento e documentação de chargeback vencida sem envio marcado.

## Condições de atenção

São monitoradas tentativas pendentes por mais de 24 horas, webhooks falhos recentes, alertas falhos, reembolsos que exigem atenção, chargebacks abertos com erro, falhas ou paralisação da reconciliação, falhas recentes do gateway, assinaturas de webhook inválidas e a saúde dos crons de reconciliação, alertas, chargebacks e do próprio health check.

## Agendamento e monitoramento cruzado

O job `payment-financial-health-check` roda nos minutos `3,8,13,18,23,28,33,38,43,48,53,58`. O deslocamento evita competir com a reconciliação principal, executada nos múltiplos de cinco minutos.

O health check verifica se os outros jobs financeiros estão ativos e executando recentemente. Em sentido inverso, `private.scan_payment_alert_conditions()` verifica se o último health check tem mais de 15 minutos. Assim, a rotina não depende exclusivamente de si mesma para detectar uma paralisação.

## Alertas

O tipo `financial_health_check` usa o pipeline existente de alertas financeiros. Um alerta é criado apenas quando:

- o estado entra em `degraded` ou `critical` vindo de `healthy`/sem histórico;
- a severidade muda; ou
- o conjunto de invariantes violadas muda.

Enquanto a mesma condição persiste, execuções periódicas não criam novos alertas. Depois de uma recuperação para `healthy`, uma reincidência da mesma falha constitui um novo incidente e pode gerar novo alerta.

O scanner de alertas também cria `financial_health_check` crítico se o próprio health check ficar sem execução por mais de 15 minutos.

## Dashboard

`get_teacher_payment_operations_dashboard` inclui o último estado persistido em `financial_health`. A interface `/mensalidades/` mostra o estado como `SAUDÁVEL`, `ATENÇÃO`, `CRÍTICO` ou `ATRASADO`, além da data da última execução e da contagem de invariantes críticas/em atenção.

O RPC continua protegido por `is_teacher_admin_mfa()`, exigindo conta administrativa do professor com AAL2.

## Testes seguros

Para simular uma invariante em produção sem efeito externo, a função aceita `target_notify=false`. Qualquer simulação deve ocorrer dentro de transação seguida de `ROLLBACK`. O seed da migração também usa `notify=false`, evitando e-mail durante implantação.
