# Protocolo do primeiro refund real em produção

Data de referência: 12 de setembro de 2026.

## Princípio

O primeiro refund real deve ser validado **quando existir uma necessidade legítima de devolução**. Não criar nem reembolsar uma transação real apenas para testar o sistema.

Até a data deste documento, `payment_refund_requests` não possui refunds de produção registrados.

## Pré-condições

Antes de iniciar o primeiro refund legítimo:

1. confirmar health financeiro recente `healthy`;
2. confirmar que a mensalidade está associada a uma tentativa Mercado Pago aprovada e aplicada;
3. confirmar `provider_payment_id` e valor diretamente pelo estado autoritativo do backend;
4. confirmar que a tentativa não está em estado terminal já revertido (`refunded`, `charged_back` ou `cancelled`);
5. confirmar que não há chargeback aberto para o mesmo pagamento;
6. acessar a operação como professor/admin com MFA/AAL2;
7. registrar um motivo operacional sem inserir PII desnecessária.

## Execução

Usar exclusivamente a Edge Function `refund-mercado-pago-payment` pelo fluxo administrativo existente.

A operação exige a confirmação literal:

```text
REEMBOLSAR
```

O backend deve:

- iniciar/recuperar uma única `payment_refund_requests` para a mensalidade;
- reutilizar a mesma `idempotency_key` em retentativas;
- reconsultar o Mercado Pago **antes** de criar o refund;
- evitar uma segunda chamada ao provedor se o pagamento já estiver revertido;
- criar refund integral em `/v1/payments/{payment_id}/refunds` sem armazenar dados de cartão;
- reconsultar o pagamento depois da aceitação do provedor;
- convergir por sincronização/reconciliação mesmo quando a resposta da chamada original for ambígua.

## Evidência obrigatória

Após a solicitação, registrar apenas evidência técnica sem PII.

### No Mercado Pago / sincronização

Confirmar:

- mesmo `provider_payment_id` da tentativa original;
- estado terminal de reversão esperado;
- refund integral correspondente ao pagamento;
- `provider_refund_id` quando retornado pelo provedor.

### No banco

Confirmar em `payment_refund_requests`:

- existe somente o caso esperado para a operação;
- `idempotency_key` permanece estável entre retentativas;
- `attempt_count` condiz com as tentativas realizadas;
- `provider_refund_id` é persistido quando disponível;
- estado final converge para `synchronized` ou estado equivalente concluído pela rotina vigente;
- `last_error` fica vazio depois da convergência bem-sucedida.

Confirmar também:

- `tuition_payment_attempts.reversed_at` preenchido quando a reversão for aplicada;
- a mensalidade deixou de permanecer como paga quando a regra financeira exigir reversão;
- não houve segunda baixa nem segunda devolução;
- reconciliação não introduziu divergência.

## Resultado HTTP 202

HTTP 202 não deve ser tratado como falha nem como conclusão final. Significa que o provedor aceitou ou que a operação ficou pendente de convergência.

Nesse caso:

1. não enviar uma segunda solicitação com outra chave;
2. manter a mesma operação/idempotência;
3. aguardar Webhook/reconciliação;
4. reconsultar o estado local depois da convergência;
5. escalar somente se o health/alerta indicar ausência de convergência.

## Falha ou resultado ambíguo

Se a Edge Function retornar falha de gateway ou resultado desconhecido:

- não criar novo refund manual fora do fluxo;
- não alterar `provider_payment_id`;
- não gerar nova `idempotency_key` para contornar o caso;
- consultar o provedor antes de qualquer repetição;
- deixar a reconciliação determinar se o efeito financeiro ocorreu;
- seguir `payment_incident_runbook.md` se a operação permanecer inconclusiva.

## Analytics

O refund financeiro não depende do GA4. Falha de analytics nunca deve bloquear a devolução.

Quando a Fase B de analytics server-side estiver ativa, a reversão autoritativa deverá enfileirar no máximo um evento `refund` para o mesmo `provider_payment_id`, conforme a restrição única do outbox.

## Critério de encerramento do primeiro refund real

O gate só pode ser marcado como concluído quando todos os itens abaixo forem verdadeiros:

- necessidade legítima de refund documentada;
- MFA validado;
- provider recebeu/confirmou a reversão;
- estado local convergiu;
- `provider_refund_id` registrado quando fornecido;
- `reversed_at`/estado financeiro local coerentes;
- nenhuma duplicidade de devolução;
- nenhuma divergência de mensalidade;
- health financeiro posterior `healthy` com `issue_count = 0`;
- nenhum alerta crítico aberto decorrente do refund.

Depois da conclusão, atualizar `payment_operational_audit.md` e `payment_operational_readiness_report.md` com data e evidência técnica mínima, sem nome, e-mail, CPF, WhatsApp ou qualquer dado de cartão do aluno.
