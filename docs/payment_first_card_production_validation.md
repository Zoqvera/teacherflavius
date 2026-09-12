# Protocolo do primeiro pagamento real por cartão

Data de referência: 12 de setembro de 2026.

## Objetivo

Validar o primeiro pagamento legítimo por cartão em produção sem criar uma cobrança artificial apenas para teste.

O cartão já foi validado em sandbox para aprovação, rejeição, idempotência, Webhook, reconciliação, recuperação de falhas transitórias e concorrência. Este protocolo existe apenas para confirmar que o primeiro evento real percorre corretamente a infraestrutura de produção.

## Regra principal

Não criar um pagamento real, não usar cartão próprio e não pedir a um aluno que pague apenas para validar o sistema.

A validação começa somente quando um pagamento legítimo por cartão acontecer naturalmente.

## Pré-condições

Antes de acompanhar a transação, confirmar:

- health financeiro recente com status `healthy`;
- `payment_creation_control.enabled = true`;
- cron `mercado-pago-reconciliation` ativo;
- cron `payment-alert-health-scan` ativo;
- cron `payment-financial-health-check` ativo;
- Webhook de produção do Mercado Pago configurado;
- ausência de alertas críticos financeiros abertos.

Se alguma pré-condição não estiver satisfeita, corrigir primeiro a infraestrutura. Não usar um pagamento real como ferramenta de diagnóstico.

## Evidência mínima a observar

Quando o primeiro cartão legítimo for aprovado, registrar apenas identificadores técnicos necessários. Nunca copiar número completo do cartão, CVV, Access Token, segredo de Webhook ou CPF para logs/manuais.

Confirmar, nesta ordem:

1. existe uma única tentativa local para a mensalidade;
2. a tentativa possui `provider = mercado_pago`;
3. `payment_method = card`;
4. existe um único `provider_payment_id` não nulo;
5. `amount` coincide exatamente com o valor devido da mensalidade;
6. o estado do Mercado Pago consultado por ID é `approved`;
7. `live_mode = true` no pagamento de produção;
8. `external_reference` aponta para a tentativa local correta;
9. o Webhook correspondente foi persistido, quando entregue;
10. a baixa local ocorreu uma única vez;
11. `applied_at` foi preenchido uma única vez;
12. a mensalidade foi marcada como paga pelo valor correto;
13. não existe outro pagamento aprovado para a mesma mensalidade;
14. não existe duplicidade de `provider_payment_id`;
15. a reconciliação automática posterior termina sem erro;
16. o health financeiro seguinte continua `healthy`.

## Se o Webhook não chegar

Não criar uma nova cobrança e não alterar a mensalidade manualmente.

Aguardar a janela normal de reconciliação. O reconciliador deve localizar o estado atual do pagamento no Mercado Pago e aplicar a mesma RPC atômica de settlement.

Depois confirmar:

- `last_reconciled_at` atualizado;
- `reconciliation_failure_count = 0` após convergência;
- `last_reconciliation_error IS NULL`;
- baixa financeira realizada uma única vez.

## Se o cartão for rejeitado

Uma rejeição legítima não valida o caminho de baixa, mas ainda deve cumprir:

- tentativa persistida sem `applied_at`;
- mensalidade permanece em aberto;
- nenhum evento `payment_recorded` é criado;
- nenhum novo pagamento é criado automaticamente sem nova ação explícita do aluno;
- mensagem exibida ao aluno não expõe detalhes internos do gateway.

## Se houver estado ambíguo

Exemplos: timeout depois de criar a cobrança, resposta 5xx, status ainda pendente ou falha entre provedor e persistência local.

Procedimento:

1. não repetir a cobrança com uma nova chave de idempotência;
2. preservar a tentativa existente;
3. consultar o pagamento pelo `provider_payment_id` quando disponível;
4. deixar a reconciliação convergir o estado;
5. usar o kill switch se houver risco sistêmico de novas cobranças;
6. seguir `docs/payment_incident_runbook.md` se a divergência persistir.

## Critérios de conclusão

O primeiro cartão real é considerado validado somente quando todos os pontos abaixo forem verdadeiros:

- pagamento aprovado confirmado no Mercado Pago;
- valor e referência conferidos;
- baixa local aplicada exatamente uma vez;
- nenhuma duplicidade financeira detectada;
- Webhook processado ou reconciliação comprovadamente convergente;
- health financeiro posterior `healthy`;
- nenhum alerta crítico aberto decorrente da transação.

Depois da conclusão, atualizar `docs/payment_operational_audit.md` com a data e a evidência técnica mínima da validação, sem dados pessoais do aluno.

## Escopo de privacidade

A evidência operacional deve usar IDs técnicos e estados. Não registrar em documentação de repositório:

- nome do aluno;
- e-mail;
- CPF;
- número do cartão;
- CVV;
- token do cartão;
- Access Token do Mercado Pago;
- segredo HMAC/Webhook.
