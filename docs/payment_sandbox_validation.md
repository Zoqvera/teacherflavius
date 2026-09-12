# Validação sandbox de pagamentos Mercado Pago

Data de referência: 12 de setembro de 2026.

## Objetivo

Validar a integração de cartão com o Mercado Pago sem gerar cobrança real e sem alterar a base financeira de produção do TeacherFlavius.com.

O processo separa três níveis de validação:

1. um probe agendado e somente leitura para confirmar que a credencial de teste continua válida;
2. um smoke test manual e explícito que cria transações exclusivamente no ambiente de teste do Mercado Pago;
3. endpoints sandbox separados para validar Webhook, reconciliação, convergência e falhas transitórias sem tocar nas tabelas financeiras de produção.

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

A execução manual `Payment contracts #48`, em 11 de setembro de 2026, concluiu com sucesso e confirmou aprovação, rejeição, consulta e preservação de idempotência com o mesmo `payment_id` no replay.

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
- não lê nem altera `monthly_tuition` ou `tuition_payment_attempts`;
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
7. use **Simular** quando precisar validar a entrega assinada de teste.

A URL de teste e a assinatura de teste devem permanecer separadas das configurações de produção.

## Evidência de Webhook validada

Em 11 de setembro de 2026, o simulador oficial do Mercado Pago entregou com sucesso uma notificação assinada para o pagamento sandbox aprovado `1328152152`.

A evidência persistida confirmou:

- `signature_valid = true`;
- `live_mode = false`;
- `provider_status = approved`;
- `provider_status_detail = accredited`;
- `payment_method_id = master`;
- valor sandbox de 10,00;
- `external_reference` com prefixo `sandbox-card-`.

Uma segunda simulação da mesma notificação não gerou novo efeito: permaneceu um único registro, com `delivery_count` passando de 1 para 2.

## Reconciliação sandbox isolada

O endpoint `reconcile-mercado-pago-sandbox` valida a recuperação que seria necessária quando uma notificação não chega.

A busca por `external_reference` usa `/v1/payments/search` apenas para descobrir IDs. Cada ID candidato é reconsultado individualmente em `/v1/payments/{id}`. A consulta individual é a fonte autoritativa para validar:

- ID;
- `external_reference`;
- valor;
- `live_mode=false`;
- status atual do provedor.

Essa separação foi adotada depois que um resultado resumido de busca apresentou `live_mode` incompatível com a consulta individual. Resultados de busca nunca são aceitos diretamente para recuperação.

## Cenários de convergência validados

### Webhook perdido

Um candidato sem `provider_payment_id` foi reconciliado exclusivamente por `external_reference` e valor. O pagamento `1328152152` foi recuperado como `approved`, `accredited`, método `master`, `live_mode=false`, sem consultar a tabela de evidências de Webhook e sem tocar nas tabelas financeiras reais.

### `not_found -> retry -> recovered`

Foi criada primeiro uma referência inexistente no Mercado Pago. A primeira reconciliação terminou `pending/not_found`. Depois foi criado um pagamento sandbox aprovado com a mesma `external_reference`; a segunda execução recuperou o pagamento `1328152736`, limpou o erro e terminou `recovered`.

### Falha transitória de gateway

Foram exercitados estados persistidos equivalentes a:

- `gateway_http_503`;
- `gateway_unreachable`/timeout.

Em ambos, a execução seguinte contra o Mercado Pago recuperou o pagamento e terminou `recovered`. O harness não tenta fazer o Mercado Pago devolver artificialmente um 503/timeout; ele valida separadamente a classificação da falha e a recuperação a partir do estado persistido correspondente.

### Falhas repetidas e escalada

O domínio de produção foi endurecido para distinguir falha isolada de repetição:

- 1ª falha consecutiva: `warning`;
- 2ª falha: retry sem novo alerta;
- 3ª falha: alerta `critical` deduplicado;
- falhas seguintes: retry continua sem spam de alertas;
- sucesso posterior: contador volta a zero e erro é limpo.

### Concorrência

Uma corrida controlada entre o sincronizador utilizado pelo Webhook e o reconciliador automático confirmou que o mesmo pagamento não é aplicado duas vezes. O teste temporário foi removido depois da validação; o contrato permanente de locks e baixa condicional permanece no repositório.

## Critérios de segurança

- nenhuma mensalidade de produção é criada ou alterada pelos testes sandbox;
- nenhuma conta de aluno de produção é usada no smoke test;
- nenhum segredo é versionado no repositório;
- o teste de escrita é manual e nunca roda por cron;
- o probe agendado continua somente leitura;
- o Webhook sandbox rejeita eventos de produção;
- o Webhook sandbox usa credenciais e assinatura distintas das de produção;
- `X-Idempotency-Key` é reutilizada apenas no cenário de replay intencional;
- o reconciliador sandbox não consulta evidências de Webhook para declarar recuperação;
- a infraestrutura sandbox não chama a RPC de baixa financeira de produção;
- o teste falha quando a infraestrutura sandbox obrigatória não está configurada.

## Estado atual

A integração sandbox de cartão está validada de ponta a ponta para os objetivos definidos neste documento: credencial, tokenização, aprovação, rejeição, idempotência, consulta autoritativa, Webhook assinado, deduplicação, Webhook perdido, convergência após `not_found`, recuperação após falha transitória e concorrência sem baixa duplicada.

A lacuna remanescente não é de sandbox: até 12 de setembro de 2026 ainda não havia um cartão aprovado em produção. Esse evento deve ser observado somente quando ocorrer um pagamento legítimo, seguindo `docs/payment_first_card_production_validation.md`; não deve ser provocado com uma cobrança real artificial.
