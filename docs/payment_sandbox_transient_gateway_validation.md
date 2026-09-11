# Validação sandbox de falhas transitórias do gateway

Data de referência: 11 de setembro de 2026.

## Objetivo

Validar que uma indisponibilidade transitória do Mercado Pago não transforma um candidato de reconciliação em falha terminal e que uma execução posterior converge normalmente quando o gateway volta a responder.

A validação é isolada da base financeira de produção e usa apenas `public.mercado_pago_sandbox_reconciliation_candidates` e a Edge Function `reconcile-mercado-pago-sandbox`.

## Classificação de falhas

O reconciliador sandbox já modela erros de comunicação com o provedor como `SandboxReconciliationError` não terminal por padrão:

- falha de rede/timeout -> `gateway_unreachable`;
- resposta HTTP não 2xx -> `gateway_http_<status>`.

No bloco de tratamento, erros terminais seguem para `markCandidateFailed`; os demais seguem para `markCandidatePending`. Portanto, falhas de transporte e HTTP do gateway permanecem elegíveis para uma nova reconciliação.

Essa classificação é coberta pelos contratos automatizados em `tests/payment_sandbox_reconciliation_contract.test.js`.

## Fault injection controlada

O Mercado Pago não oferece uma interface sandbox suportada para solicitar deliberadamente um HTTP 5xx ou timeout. Não se tenta degradar, bloquear ou manipular o serviço externo.

Para validar a máquina de estados de retry sem depender de uma falha real do provedor, o teste injeta somente o estado persistido que o reconciliador produz após uma falha transitória. A tabela sandbox aceita os rótulos:

- `transient_gateway_503`;
- `transient_gateway_timeout`.

A injeção é feita exclusivamente na tabela sandbox: candidato `pending`, `provider_payment_id = NULL`, `reconciliation_attempts = 1` e `last_error_code` correspondente à falha. Nenhuma tabela financeira real é alterada.

Em seguida, o dispatcher assinado normal é executado. A Edge Function faz uma consulta real ao Mercado Pago com `MERCADO_PAGO_TEST_ACCESS_TOKEN`. Se o provedor estiver disponível, o candidato deve convergir para `recovered` na tentativa seguinte.

## Cenário HTTP 503

Estado inicial controlado:

- `scenario = 'transient_gateway_503'`;
- `reconciliation_status = 'pending'`;
- `provider_payment_id = NULL`;
- `reconciliation_attempts = 1`;
- `last_error_code = 'gateway_http_503'`.

A próxima reconciliação deve consultar o provedor normalmente e, existindo uma correspondência sandbox válida, preencher o ID e o status do pagamento, limpar `last_error_code` e incrementar `reconciliation_attempts`.

## Cenário timeout/rede

O mesmo procedimento é repetido com:

- `scenario = 'transient_gateway_timeout'`;
- `last_error_code = 'gateway_unreachable'`.

A recuperação posterior deve produzir o mesmo comportamento de convergência.

## Limites do teste

Este teste não afirma que o Mercado Pago realmente devolveu 503 ou sofreu timeout durante a execução. Ele valida duas propriedades separadas e verificáveis:

1. o código que recebe falhas HTTP/rede as classifica como não terminais e persiste `pending`;
2. a partir desse estado persistido, uma execução posterior real contra o Mercado Pago recupera o candidato.

Isso evita criar uma dependência de comportamento destrutivo ou não suportado no ambiente externo de sandbox.

## Isolamento e segurança

A migration `20260911183822_extend_mercado_pago_sandbox_reconciliation_scenarios.sql` altera apenas a constraint de cenário da tabela sandbox. Não cria cron, não concede acesso a `anon`/`authenticated` e não toca em `monthly_tuition`, `tuition_payment_attempts`, `payment_reconciliation_runs` ou baixas financeiras de alunos.

## SEO

Sem impacto. Esta validação altera apenas documentação, contratos de teste e uma constraint de tabela sandbox; não modifica páginas públicas, URLs, metadata, sitemap, robots ou conteúdo indexável do site.
