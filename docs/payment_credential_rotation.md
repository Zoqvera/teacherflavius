# Rotação de credenciais do domínio financeiro

Data de referência: 12 de setembro de 2026.

## Objetivo

Executar rotações de credenciais financeiras sem expor segredos, sem criar cobrança artificial e sem romper webhook, reconciliação ou recuperação.

Este documento registra **nomes e dependências**, nunca valores de segredos.

## Regra fundamental

Nunca colocar em chat, issue, PR, commit, log ou screenshot:

- Access Token do Mercado Pago;
- segredo de assinatura do Webhook;
- `GA4_API_SECRET`;
- segredo HMAC interno;
- dados completos de cartão, CVV ou token de cartão.

A rotação efetiva de credenciais externas deve ser feita diretamente no painel do provedor e no armazenamento de secrets correspondente.

## Inventário

### Produção Mercado Pago

`MERCADO_PAGO_ACCESS_TOKEN`
: segredo server-side consumido pelas Edge Functions financeiras que consultam ou escrevem no Mercado Pago.

`MERCADO_PAGO_WEBHOOK_SECRET`
: segredo usado para autenticar notificações do Webhook de produção.

`MERCADO_PAGO_PUBLIC_KEY`
: identificador público usado pelo frontend para inicializar o SDK. Não é tratado como segredo, mas deve permanecer alinhado à aplicação correta.

### Sandbox Mercado Pago

`MERCADO_PAGO_TEST_ACCESS_TOKEN`
: credencial exclusivamente de teste.

`MERCADO_PAGO_TEST_WEBHOOK_SECRET`
: assinatura do endpoint sandbox.

As credenciais de cartão de teste existentes no GitHub Actions são exclusivamente sandbox e não podem ser copiadas para produção.

### Analytics

`GA4_API_SECRET`
: segredo do Measurement Protocol. Deve existir somente no ambiente server-side. A Fase B do analytics financeiro não deve ser ativada sem ele.

### HMAC interno

`mercado_pago_reconciliation_cron_secret`
: segredo no Supabase Vault usado para autenticar dispatches internos de reconciliação e outros endpoints server-to-server que reutilizam o mesmo validador.

Na revisão de 12 de setembro de 2026, a entrada existe no Vault desde `2026-09-09 19:45:24+00`. O valor não foi lido nem registrado neste documento.

## Ordem de rotação

Não rotacionar todas as credenciais simultaneamente. Executar uma por vez e exigir evidência de saúde antes de iniciar a próxima.

### 1. Credencial de teste

Rotacionar primeiro as credenciais sandbox quando houver necessidade. Atualizar os secrets de teste nos ambientes que realmente os consomem e executar o probe read-only antes de qualquer teste de cartão.

Critério de saída:

- autenticação sandbox válida;
- Payment Contracts verde;
- nenhum segredo de produção alterado.

### 2. Access Token de produção

Antes da rotação:

1. confirmar health financeiro `healthy`;
2. confirmar ausência de tentativa pendente que exija intervenção imediata;
3. manter reconciliação e webhooks disponíveis;
4. considerar o kill switch de **novas cobranças** durante a janela de troca, sem desligar recuperação.

Executar a rotação no painel oficial do Mercado Pago e substituir `MERCADO_PAGO_ACCESS_TOKEN` diretamente no armazenamento de secrets do Supabase. Não enviar o valor por chat.

Depois da troca, validar nesta ordem:

1. uma consulta server-side não destrutiva ao Mercado Pago;
2. reconciliação automática sem erro de autenticação;
3. Webhook/replay continuam capazes de reconsultar o provedor;
4. health financeiro volta a `healthy` com zero issues críticos;
5. reativar novas cobranças caso o kill switch tenha sido usado.

Se a nova credencial falhar e a anterior ainda for válida, restaurar a anterior diretamente no armazenamento seguro. Se a anterior tiver sido invalidada pelo provedor, manter novas cobranças bloqueadas até corrigir a credencial.

### 3. Segredo do Webhook de produção

Esta rotação é independente do Access Token. Alterar somente durante uma janela controlada.

Sequência:

1. confirmar que a reconciliação automática está saudável, pois ela é o mecanismo de convergência caso uma notificação seja perdida durante a janela;
2. rotacionar/restabelecer o segredo no painel do Mercado Pago somente quando a troca for intencional;
3. atualizar `MERCADO_PAGO_WEBHOOK_SECRET` diretamente no secret store do Supabase;
4. validar assinatura com uma notificação legítima subsequente ou procedimento oficial suportado;
5. acompanhar Webhook log e health até confirmar ausência de `invalid_signature` em sequência.

Não pressionar a opção de restabelecer segredo apenas para consultar o valor: essa ação pode efetivamente rotacioná-lo.

### 4. HMAC interno

O segredo `mercado_pago_reconciliation_cron_secret` só deve ser rotacionado quando todos os signatários e validadores que dependem dele puderem ser atualizados de forma coordenada.

Antes de alterar:

- localizar todos os dispatchers que leem esse nome no Vault;
- confirmar que não existe consumidor externo com cópia independente;
- impedir que jobs sejam executados com metade da infraestrutura usando o valor antigo.

Depois da troca:

- executar um dispatch controlado;
- exigir HTTP de sucesso do endpoint interno;
- confirmar nova execução de reconciliação;
- confirmar health `healthy`.

Não rotacionar esse segredo apenas para cumprir calendário se não houver uma janela segura e necessidade definida.

### 5. GA4 Measurement Protocol

Criar/rotacionar `GA4_API_SECRET` no painel do Google Analytics e gravá-lo diretamente no Supabase. Antes de ativar qualquer cron:

- validar `dispatch-payment-analytics` com configuração válida;
- confirmar resposta de sucesso do Measurement Protocol;
- confirmar um item controlado `pending -> sent` sem duplicidade;
- somente depois retirar a dependência do `purchase` client-side conforme `payment_server_analytics.md`.

## Critérios de rollback

Interromper a rotação e restaurar o estado anterior quando ocorrer qualquer um destes sinais:

- HTTP 401/403 novo nas chamadas financeiras;
- burst de Webhooks inválidos;
- reconciliação sem heartbeat;
- pagamento aprovado deixando de convergir;
- health `degraded` ou `critical` relacionado à mudança;
- duplicidade de efeito financeiro.

O rollback nunca deve apagar eventos de auditoria nem criar uma nova cobrança para testar recuperação.

## Evidência mínima

Para cada rotação concluída, registrar sem segredo:

- nome lógico da credencial;
- data/hora da rotação;
- operador;
- motivo;
- validações executadas;
- health antes/depois;
- incidentes observados;
- rollback necessário: sim/não.

## Estado desta etapa

O procedimento de rotação está implementado e o inventário foi confirmado. **Nenhuma credencial externa foi rotacionada automaticamente nesta etapa**, porque os valores pertencem aos painéis do Mercado Pago/Google e a ferramenta conectada não possui operação segura de rotação desses secrets. Isso é intencional: a execução deve ocorrer diretamente no painel do provedor sem revelar o valor ao ChatGPT ou ao repositório.
