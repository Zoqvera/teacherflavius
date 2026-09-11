# Validação sandbox de pagamentos Mercado Pago

Data de referência: 11 de setembro de 2026.

## Objetivo

Validar a integração de cartão com o Mercado Pago sem gerar cobrança real e sem alterar a base financeira de produção do TeacherFlavius.com.

O processo separa três níveis de validação:

1. um probe agendado e somente leitura para confirmar que a credencial de teste continua válida;
2. um smoke test manual e explícito que cria transações exclusivamente no ambiente de teste do Mercado Pago;
3. um endpoint de Webhook sandbox separado que valida HMAC, reconsulta o pagamento no Mercado Pago e persiste evidência fora das tabelas financeiras de produção.

Nenhum teste sandbox deve usar credenciais de produção.

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

Em 11 de setembro de 2026, a execução manual `Payment contracts #48` concluiu com sucesso e confirmou aprovação, rejeição, consulta e preservação de idempotência com o mesmo `payment_id` no replay.

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

## Como executar o cartão sandbox

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

## Webhook sandbox isolado

O endpoint de teste é separado do webhook de produção:

```text
https://wnigzpvgsbpjdxvjzugt.supabase.co/functions/v1/mercado-pago-sandbox-webhook
```

Ele é deliberadamente público no gateway (`verify_jwt=false`) porque o Mercado Pago não envia JWT do Supabase. A própria função aplica os controles de segurança necessários:

- exige `x-signature` HMAC válida;
- exige `live_mode=false` tanto no evento quanto no pagamento consultado no provedor;
- aceita somente eventos `payment`;
- exige que o pagamento exista no ambiente de teste do Mercado Pago;
- exige `external_reference` iniciando por `sandbox-card-`;
- reconsulta `/v1/payments/{id}` com o Access Token de teste antes de persistir evidência;
- não chama `process_mercado_pago_payment`;
- não lê nem altera `monthly_tuition` ou `payment_attempts`;
- persiste apenas em `public.mercado_pago_sandbox_webhook_events`, tabela com RLS habilitado e acesso revogado para `public`, `anon` e `authenticated`.

## Secrets necessários no Supabase para o webhook sandbox

Adicionar em **Supabase > Edge Functions > Secrets**:

- `MERCADO_PAGO_TEST_ACCESS_TOKEN`
- `MERCADO_PAGO_TEST_WEBHOOK_SECRET`

`MERCADO_PAGO_TEST_ACCESS_TOKEN` deve ser o mesmo Access Token de teste usado no GitHub Actions. `MERCADO_PAGO_TEST_WEBHOOK_SECRET` é a assinatura secreta gerada pelo Mercado Pago ao salvar a URL de Webhook no modo de teste.

Não substituir `MERCADO_PAGO_ACCESS_TOKEN` nem `MERCADO_PAGO_WEBHOOK_SECRET`; esses nomes permanecem reservados ao ambiente de produção.

## Configuração no Mercado Pago

Em **Suas integrações > aplicação TeacherFlavius > Webhooks > Configurar notificações**:

1. selecione o modo de teste;
2. informe a URL do endpoint sandbox acima;
3. habilite o evento **Pagamentos**;
4. salve a configuração;
5. revele/copiei a assinatura secreta de teste;
6. cadastre essa assinatura no Supabase como `MERCADO_PAGO_TEST_WEBHOOK_SECRET`;
7. execute novamente o smoke test manual de cartão no GitHub.

A documentação oficial do Mercado Pago recomenda URLs distintas para teste e produção e gera uma assinatura secreta própria para validar a origem das notificações.

## Evidência de Webhook e convergência

Depois de um novo pagamento sandbox, a validação é concluída quando existe um registro recente em `public.mercado_pago_sandbox_webhook_events` com:

- `signature_valid = true`;
- `live_mode = false`;
- `provider_payment_id` correspondente ao pagamento sandbox;
- `provider_status` obtido por reconsulta ao Mercado Pago;
- `external_reference` iniciando por `sandbox-card-`;
- `transaction_amount > 0`.

Essa reconsulta do provedor no momento do Webhook valida o mecanismo de convergência server-side sem utilizar a base financeira de produção.

A recuperação de produção quando uma notificação não chega continua sendo responsabilidade do reconciliador principal, que possui contratos, heartbeat e health checks próprios. O sandbox não injeta pagamentos de teste nas tabelas reais apenas para simular uma falha de Webhook.

## Critérios de segurança

- nenhuma mensalidade de produção é criada ou alterada;
- nenhuma conta de aluno de produção é usada no smoke test;
- nenhum segredo é versionado no repositório;
- o teste de escrita é manual e nunca roda por cron;
- o probe agendado continua somente leitura;
- o Webhook sandbox rejeita eventos de produção;
- o Webhook sandbox usa credenciais e assinatura distintas das de produção;
- `X-Idempotency-Key` é reutilizada apenas no cenário de replay intencional;
- o teste falha quando a infraestrutura sandbox obrigatória não está configurada.

## Estado atual

A integração de cartão sandbox já foi validada ao vivo contra o Mercado Pago. O Webhook sandbox isolado deve ser considerado validado ao vivo somente depois que a URL de teste estiver salva no painel do Mercado Pago, os dois secrets de teste estiverem presentes no Supabase e um novo smoke test produzir evidência na tabela sandbox.
