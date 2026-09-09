# Alertas operacionais de pagamento

O fluxo de pagamentos do Teacherflavius.com usa uma fila interna de alertas em `payment_alert_notifications` e eventos operacionais em `payment_operational_events`.

## Eventos monitorados

- falha de reconciliação Mercado Pago ↔ banco;
- possível pagamento duplicado;
- pagamento aprovado sem baixa após 2 minutos;
- refund, chargeback ou cancelamento aplicado;
- reversão pendente após 2 minutos;
- três ou mais webhooks com assinatura inválida em 15 minutos;
- falhas HTTP 429/5xx ou falhas de comunicação com o gateway.

## Entrega e deduplicação

Os alertas são enviados por e-mail pela Edge Function `notify-payment-alert`, usando o canal Resend já configurado no projeto. Cada alerta possui uma chave de deduplicação. Falhas de gateway são agrupadas por janela de 15 minutos e rajadas de webhooks inválidos geram no máximo um alerta por janela de 15 minutos.

Alertas com falha de entrega são reencaminhados automaticamente pelo health scan, até cinco tentativas, com intervalo mínimo de 10 minutos.

## Health scan

O job `payment-alert-health-scan` roda a cada 5 minutos. Ele procura:

- pagamentos `approved` sem `applied_at` há mais de 2 minutos;
- pagamentos `cancelled`, `refunded` ou `charged_back` ainda sem `reversed_at` há mais de 2 minutos;
- alertas de e-mail que precisam de retentativa.

## Segurança e privacidade

As tabelas operacionais usam RLS sem policies e têm acesso revogado para `anon` e `authenticated`. A RPC `record_payment_operational_event` é executável somente por `service_role`.

Os e-mails de alerta não incluem nome, e-mail, CPF, telefone ou outros dados cadastrais do aluno. O identificador do alerta é fornecido para correlação interna.
