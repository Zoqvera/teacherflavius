# Validação sandbox de pagamentos Mercado Pago

Data de referência: 11 de setembro de 2026.

## Objetivo

Validar a integração de cartão com o Mercado Pago sem gerar cobrança real e sem alterar a base financeira de produção do TeacherFlavius.com.

O processo separa dois níveis de validação:

1. um probe agendado e somente leitura para confirmar que a credencial de teste continua válida;
2. um smoke test manual e explícito que cria transações exclusivamente no ambiente de teste do Mercado Pago.

Nenhum teste de cartão sandbox deve usar credenciais de produção.

## Probe agendado de credencial

O job `sandbox-credential-probe` executa uma requisição autenticada somente leitura contra a API do Mercado Pago.

A execução é fail-closed: se `MERCADO_PAGO_TEST_ACCESS_TOKEN` não estiver configurado no GitHub Actions, o job falha. A ausência da credencial não pode ser interpretada como validação bem-sucedida.

Esse job não cria pagamentos, tokens de cartão ou outros efeitos financeiros externos.

## Smoke test manual de cartão

O job `sandbox-card-payment-probe` é executado somente por `workflow_dispatch` e somente quando o input `run_card_probe` for marcado como `true`.

Ele valida, nessa ordem:

1. autenticação da credencial de teste;
2. tokenização de cartão de teste com titular `APRO`;
3. criação de pagamento que deve retornar `approved`;
4. reenvio da mesma criação com a mesma `X-Idempotency-Key`;
5. confirmação de que o replay devolve o mesmo `payment_id`;
6. consulta do pagamento por ID, que deve continuar `approved`;
7. nova tokenização com titular `OTHE`;
8. criação de pagamento que deve retornar `rejected`.

O teste usa valor baixo de sandbox e uma parcela. Os identificadores retornados podem aparecer no log, mas Access Token, Public Key, número do cartão e código de segurança não são impressos.

## Secrets necessários no GitHub Actions

Os valores devem vir exclusivamente das credenciais e cartões de teste fornecidos pelo Mercado Pago:

- `MERCADO_PAGO_TEST_ACCESS_TOKEN`
- `MERCADO_PAGO_TEST_PUBLIC_KEY`
- `MERCADO_PAGO_TEST_CARD_NUMBER`
- `MERCADO_PAGO_TEST_CARD_SECURITY_CODE`
- `MERCADO_PAGO_TEST_CARD_EXPIRATION_MONTH`
- `MERCADO_PAGO_TEST_CARD_EXPIRATION_YEAR`
- `MERCADO_PAGO_TEST_PAYER_EMAIL`

Não reutilizar os secrets de produção para preencher esses campos.

## Como executar

No GitHub:

1. abra **Actions**;
2. selecione **Payment contracts**;
3. escolha **Run workflow**;
4. mantenha a branch `main`;
5. marque **Run live Mercado Pago test-card smoke scenarios**;
6. execute o workflow;
7. confirme que `contracts`, `sandbox-credential-probe` e `sandbox-card-payment-probe` terminam com sucesso.

Um smoke test aprovado deve confirmar explicitamente:

- `approved_status = approved`;
- `lookup_status = approved`;
- `rejected_status = rejected`;
- `idempotency_preserved = true`;
- `approved_payment_id` igual a `replay_payment_id`.

## Webhook e reconciliação

O smoke test de cartão não envia uma notificação HMAC artificial ao webhook de produção. Isso é deliberado: uma validação de webhook sandbox deve usar a configuração de Webhooks do ambiente de teste do Mercado Pago e uma assinatura de teste própria.

Para uma validação realmente ponta a ponta do webhook, é necessário:

1. configurar a URL de callback na seção de teste da aplicação Mercado Pago;
2. manter a assinatura de teste separada da assinatura de produção;
3. gerar uma transação de teste pelo job manual;
4. verificar a chegada do evento de pagamento;
5. verificar o registro/deduplicação do webhook;
6. confirmar a convergência do estado por reconciliação caso a notificação não seja entregue.

Enquanto essa configuração isolada de webhook sandbox não estiver disponível, webhook e reconciliação continuam cobertos pelos contratos determinísticos do repositório e pelos controles operacionais de produção, mas não devem ser descritos como validados ao vivo em sandbox.

## Critérios de segurança

- nenhuma mensalidade de produção é criada ou alterada;
- nenhuma conta de aluno de produção é usada no smoke test;
- nenhum segredo é versionado no repositório;
- o teste de escrita é manual e nunca roda por cron;
- o probe agendado continua somente leitura;
- `X-Idempotency-Key` é reutilizada apenas no cenário de replay intencional;
- o teste falha quando a infraestrutura sandbox obrigatória não está configurada.

## Estado atual

A infraestrutura de CI passa a distinguir claramente entre `teste executado` e `teste não configurado`. O smoke test de cartão só pode ser considerado validado contra o provedor depois que os secrets de teste acima estiverem configurados e o job manual concluir com sucesso.
