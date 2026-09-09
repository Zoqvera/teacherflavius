# Testes da integração Mercado Pago

A integração financeira possui duas camadas complementares de validação.

## Contratos determinísticos

O workflow `Payment contracts` executa testes sem acessar o gateway e bloqueia regressões nos contratos essenciais:

- valor da mensalidade é obtido no servidor;
- criação de pagamento usa `X-Idempotency-Key`;
- `external_reference` continua apontando para a tentativa local;
- webhook valida a assinatura antes de persistir/processar;
- deduplicação prioriza o identificador único da notificação;
- sincronização reconsulta `/v1/payments/{id}` e valida pagamento, tentativa e valor;
- replay e listagem administrativa exigem MFA;
- replay usa o estado atual do gateway, não um payload antigo.

Esses testes fazem parte da suíte Node do repositório e também possuem um job dedicado no GitHub Actions.

## Sonda de credencial de teste

O script `scripts/mercado_pago_sandbox_probe.js` faz somente uma requisição autenticada de leitura para `/users/me`.

Ele não chama endpoints de criação de pagamento, não cria preferências, não envia corpo de pagamento e não imprime a credencial ou dados da conta.

Para habilitar a sonda agendada/manual no GitHub Actions, configure o secret de repositório:

`MERCADO_PAGO_TEST_ACCESS_TOKEN`

Use exclusivamente um Access Token de teste do Mercado Pago. Quando o secret não estiver configurado, a sonda termina de forma segura como `skipped`, enquanto os contratos determinísticos continuam sendo executados normalmente.

## Execução local

Contratos de pagamento:

```bash
npm run test:payment-contracts
```

Sonda somente leitura:

```bash
MERCADO_PAGO_TEST_ACCESS_TOKEN='...' npm run probe:mercado-pago-sandbox
```
